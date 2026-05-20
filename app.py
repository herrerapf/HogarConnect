from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import json
import os
import bcrypt
from datetime import datetime, timedelta
from functools import wraps
import re
import hashlib
import base64
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# CONFIGURACIÓN INICIAL
app = Flask(__name__, static_folder='public')
CORS(app)

# Configuración JWT
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'hogarconnect_super_secret_2026')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)
jwt = JWTManager(app)

# Rate Limiting
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# Configuración
DB_PATH = 'database.json'
PORT = int(os.getenv('PORT', 5000))
SESSION_TIMEOUT = 30  # minutos
UPLOAD_FOLDER = 'public/uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MAX_FILE_SIZE = 2 * 1024 * 1024  # 2MB

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# FUNCIONES DE BASE DE DATOS
def init_db():
    """Inicializa la base de datos si no existe"""
    if not os.path.exists(DB_PATH):
        initial_db = {
            "users": [],
            "serviceRequests": [],
            "chats": [],
            "ratings": [],
            "favorites": [],
            "notifications": [],
            "userSessions": [],
            "categories": ["Plomería", "Electricidad", "Limpieza", "Carpintería", 
                          "Jardinería", "Pintura", "Mudanzas", "Reparaciones", 
                          "Electrodomésticos", "Cerrajería", "Techos", "Piscinas"]
        }
        with open(DB_PATH, 'w', encoding='utf-8') as f:
            json.dump(initial_db, f, indent=2, ensure_ascii=False)

def read_db():
    init_db()
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

def write_db(data):
    with open(DB_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def generate_id():
    """Genera ID único basado en timestamp"""
    return str(int(datetime.now().timestamp() * 1000))

def sanitize_input(text):
    """Sanitiza entrada para prevenir XSS"""
    if not text:
        return ""
    return re.sub(r'[<>]', '', text.strip())

def validate_email(email):
    """Valida formato de email"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None


# FUNCIONES DE NOTIFICACIONES

def create_notification(user_id, title, message, type_notification, related_id=None):
    """Crea una nueva notificación"""
    db = read_db()
    notification = {
        'id': generate_id(),
        'userId': user_id,
        'title': title,
        'message': message,
        'type': type_notification,
        'relatedId': related_id,
        'read': False,
        'createdAt': datetime.now().isoformat()
    }
    db.setdefault('notifications', []).append(notification)
    write_db(db)
    return notification

def get_user_notifications(user_id):
    """Obtiene notificaciones de un usuario"""
    db = read_db()
    notifications = [n for n in db.get('notifications', []) if n['userId'] == user_id]
    notifications.sort(key=lambda x: x['createdAt'], reverse=True)
    return notifications


# MIDDLEWARE Y UTILIDADES
def track_user_session(user_id):
    """Registra la sesión del usuario para timeout automático"""
    db = read_db()
    sessions = db.get('userSessions', [])
    existing = next((s for s in sessions if s['userId'] == user_id), None)
    
    if existing:
        existing['lastActivity'] = datetime.now().isoformat()
    else:
        sessions.append({
            'userId': user_id,
            'lastActivity': datetime.now().isoformat(),
            'token': generate_id()
        })
    
    db['userSessions'] = sessions
    write_db(db)

def is_session_valid(user_id):
    """Verifica si la sesión sigue activa"""
    db = read_db()
    session = next((s for s in db.get('userSessions', []) if s['userId'] == user_id), None)
    if not session:
        return True
    
    last_activity = datetime.fromisoformat(session['lastActivity'])
    if datetime.now() - last_activity > timedelta(minutes=SESSION_TIMEOUT):
        return False
    return True


# RUTAS PRINCIPALES
@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('public', path)


# API - SUBIDA DE FOTO DE PERFIL
@app.route('/api/users/<user_id>/photo', methods=['POST'])
@jwt_required()
def upload_profile_photo(user_id):
    try:
        current_user = get_jwt_identity()
        if current_user['id'] != user_id:
            return jsonify({'error': 'No autorizado'}), 403

        data = request.json
        image_data = data.get('image')  # base64 string
        if not image_data:
            return jsonify({'error': 'No se recibió imagen'}), 400

        # Validar tamaño (base64 ~33% más grande que binario)
        if len(image_data) > MAX_FILE_SIZE * 1.4:
            return jsonify({'error': 'La imagen es demasiado grande (máx 2MB)'}), 400

        # Guardar como data URL directamente en el perfil del usuario
        db = read_db()
        user_index = next((i for i, u in enumerate(db['users']) if u['id'] == user_id), None)
        if user_index is None:
            return jsonify({'error': 'Usuario no encontrado'}), 404

        db['users'][user_index]['photoUrl'] = image_data
        write_db(db)

        return jsonify({'success': True, 'photoUrl': image_data})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# API - AUTENTICACIÓN
@app.route('/api/auth/register', methods=['POST'])
@limiter.limit("5 per minute")
def register():
    try:
        data = request.json
        name = sanitize_input(data.get('name', ''))
        email = data.get('email', '').lower().strip()
        password = data.get('password', '')
        role = data.get('role', '')
        phone = sanitize_input(data.get('phone', ''))
        skills = data.get('skills', [])
        
        if not name or not email or not password or not role:
            return jsonify({'error': 'Faltan campos requeridos'}), 400
        
        if len(password) < 6:
            return jsonify({'error': 'La contraseña debe tener al menos 6 caracteres'}), 400
        
        if not validate_email(email):
            return jsonify({'error': 'Email inválido'}), 400
        
        if role not in ['cliente', 'trabajador']:
            return jsonify({'error': 'Rol inválido'}), 400
        
        db = read_db()
        
        if any(u['email'] == email for u in db['users']):
            return jsonify({'error': 'Email ya registrado'}), 400
        
        hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
        
        # Generar avatar con iniciales
        initials = ''.join([word[0].upper() for word in name.split()[:2]])
        
        user = {
            'id': generate_id(),
            'name': name,
            'email': email,
            'password': hashed.decode('utf-8'),
            'role': role,
            'phone': phone,
            'skills': skills if role == 'trabajador' else [],
            'avatar': initials,
            'description': '',
            'rating': 0,
            'totalRatings': 0,
            'completedJobs': 0,
            'responseRate': 100,
            'verified': False,
            'createdAt': datetime.now().isoformat()
        }
        
        db['users'].append(user)
        write_db(db)
        
        # Crear notificación de bienvenida
        create_notification(user['id'], 'Bienvenido a HogarConnect', 
                           f'¡Gracias por unirte {name}! Comienza a explorar la plataforma.', 'welcome')
        
        access_token = create_access_token(identity={
            'id': user['id'],
            'email': user['email'],
            'role': user['role'],
            'name': user['name']
        })
        
        track_user_session(user['id'])
        
        user_data = {k: v for k, v in user.items() if k != 'password'}
        
        return jsonify({'success': True, 'token': access_token, 'user': user_data}), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/auth/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    try:
        data = request.json
        email = data.get('email', '').lower().strip()
        password = data.get('password', '')
        
        db = read_db()
        user = next((u for u in db['users'] if u['email'] == email), None)
        
        if not user:
            return jsonify({'error': 'Credenciales inválidas'}), 401
        
        if not bcrypt.checkpw(password.encode('utf-8'), user['password'].encode('utf-8')):
            return jsonify({'error': 'Credenciales inválidas'}), 401
        
        # Verificar si el trabajador puede ser verificado
        if user['role'] == 'trabajador' and user['totalRatings'] >= 5 and not user.get('verified', False):
            user['verified'] = True
            db['users'] = [u if u['id'] != user['id'] else user for u in db['users']]
            write_db(db)
            create_notification(user['id'], '¡Felicidades!', 
                               'Has sido verificado como trabajador confiable.', 'achievement')
        
        access_token = create_access_token(identity={
            'id': user['id'],
            'email': user['email'],
            'role': user['role'],
            'name': user['name']
        })
        
        track_user_session(user['id'])
        
        user_data = {k: v for k, v in user.items() if k != 'password'}
        
        return jsonify({'success': True, 'token': access_token, 'user': user_data})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/auth/logout', methods=['POST'])
@jwt_required()
def logout():
    try:
        current_user = get_jwt_identity()
        db = read_db()
        db['userSessions'] = [s for s in db.get('userSessions', []) if s['userId'] != current_user['id']]
        write_db(db)
        return jsonify({'success': True, 'message': 'Sesión cerrada'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/auth/check-session', methods=['GET'])
@jwt_required()
def check_session():
    try:
        current_user = get_jwt_identity()
        if not is_session_valid(current_user['id']):
            return jsonify({'error': 'Sesión expirada', 'logout': True}), 401
        track_user_session(current_user['id'])
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# API - SERVICIOS
@app.route('/api/services', methods=['GET'])
@jwt_required()
def get_services():
    try:
        current_user = get_jwt_identity()
        db = read_db()
        services = db.get('serviceRequests', [])
        
        # Obtener parámetros de filtrado
        category = request.args.get('category')
        min_price = request.args.get('min_price')
        max_price = request.args.get('max_price')
        sort_by = request.args.get('sort_by', 'recent')
        search = request.args.get('search', '').lower()
        
        if current_user['role'] == 'trabajador':
            services = [s for s in services if s['status'] in ['pending', 'negotiated']]
        elif current_user['role'] == 'cliente':
            services = [s for s in services if s['clientId'] == current_user['id']]
        
        # Aplicar filtros
        if category and category != 'all':
            services = [s for s in services if s['category'] == category]
        
        if min_price:
            services = [s for s in services if s['proposedPrice'] >= float(min_price)]
        
        if max_price:
            services = [s for s in services if s['proposedPrice'] <= float(max_price)]
        
        if search:
            services = [s for s in services if search in s['title'].lower() or search in s['description'].lower()]
        
        # Ordenar
        if sort_by == 'recent':
            services.sort(key=lambda x: x.get('createdAt', ''), reverse=True)
        elif sort_by == 'price_asc':
            services.sort(key=lambda x: x.get('proposedPrice', 0))
        elif sort_by == 'price_desc':
            services.sort(key=lambda x: x.get('proposedPrice', 0), reverse=True)
        
        return jsonify(services)
    except Exception as e:
        return jsonify([])

@app.route('/api/services', methods=['POST'])
@jwt_required()
@limiter.limit("10 per hour")
def create_service():
    try:
        current_user = get_jwt_identity()
        
        if current_user['role'] != 'cliente':
            return jsonify({'error': 'Solo clientes pueden publicar servicios'}), 403
        
        data = request.json
        
        location_data = data.get('location', '')
        if isinstance(location_data, dict):
            location = location_data.get('address', '')
            lat = location_data.get('lat')
            lng = location_data.get('lng')
        else:
            location = location_data
            lat = None
            lng = None
        
        service = {
            'id': generate_id(),
            'clientId': current_user['id'],
            'clientName': current_user['name'],
            'title': sanitize_input(data.get('title', '')),
            'description': sanitize_input(data.get('description', '')),
            'location': location,
            'lat': lat,
            'lng': lng,
            'proposedPrice': float(data.get('proposedPrice', 0)),
            'category': data.get('category', 'General'),
            'status': 'pending',
            'workerId': None,
            'workerName': None,
            'finalPrice': None,
            'favorites': 0,
            'views': 0,
            'createdAt': datetime.now().isoformat(),
            'updatedAt': datetime.now().isoformat()
        }
        
        db = read_db()
        db.setdefault('serviceRequests', []).append(service)
        write_db(db)
        
        # Notificar a trabajadores (simplificado)
        workers = [u for u in db['users'] if u['role'] == 'trabajador']
        for worker in workers[:5]:  # Notificar a los primeros 5 trabajadores
            create_notification(worker['id'], 'Nuevo servicio disponible',
                               f'{current_user["name"]} ha publicado: {service["title"]}', 'new_service', service['id'])
        
        return jsonify(service), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/services/<service_id>', methods=['PUT'])
@jwt_required()
def update_service(service_id):
    try:
        current_user = get_jwt_identity()
        
        if current_user['role'] != 'trabajador':
            return jsonify({'error': 'No autorizado'}), 403
        
        data = request.json
        action = data.get('action')
        
        db = read_db()
        services = db.get('serviceRequests', [])
        service_index = next((i for i, s in enumerate(services) if s['id'] == service_id), None)
        
        if service_index is None:
            return jsonify({'error': 'Servicio no encontrado'}), 404
        
        service = services[service_index]
        
        if service['status'] != 'pending':
            return jsonify({'error': 'Este servicio ya no está disponible'}), 400
        
        if action == 'accept':
            service['status'] = 'accepted'
            service['workerId'] = current_user['id']
            service['workerName'] = current_user['name']
            service['finalPrice'] = service['proposedPrice']
            
            # Notificar al cliente
            create_notification(service['clientId'], 'Servicio aceptado',
                               f'{current_user["name"]} ha aceptado tu servicio: {service["title"]}',
                               'service_accepted', service_id)
            
        elif action == 'negotiate':
            counter = data.get('counterOffer')
            if not counter or float(counter) <= 0:
                return jsonify({'error': 'Contraoferta válida requerida'}), 400
            service['status'] = 'negotiated'
            service['workerId'] = current_user['id']
            service['workerName'] = current_user['name']
            service['finalPrice'] = float(counter)
            
            # Notificar al cliente
            create_notification(service['clientId'], 'Contraoferta recibida',
                               f'{current_user["name"]} ha propuesto ${counter} para: {service["title"]}',
                               'negotiation', service_id)
        else:
            return jsonify({'error': 'Acción no válida'}), 400
        
        service['updatedAt'] = datetime.now().isoformat()
        db['serviceRequests'][service_index] = service
        write_db(db)
        
        return jsonify({'success': True, 'service': service})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/services/<service_id>/client', methods=['PUT'])
@jwt_required()
def client_action(service_id):
    try:
        current_user = get_jwt_identity()
        
        if current_user['role'] != 'cliente':
            return jsonify({'error': 'No autorizado'}), 403
        
        data = request.json
        action = data.get('action')
        
        db = read_db()
        services = db.get('serviceRequests', [])
        service_index = next((i for i, s in enumerate(services) if s['id'] == service_id), None)
        
        if service_index is None:
            return jsonify({'error': 'Servicio no encontrado'}), 404
        
        service = services[service_index]
        
        if service['clientId'] != current_user['id']:
            return jsonify({'error': 'No autorizado'}), 403
        
        if action == 'accept_negotiation' and service['status'] == 'negotiated':
            service['status'] = 'accepted'
            
            # Notificar al trabajador
            if service['workerId']:
                create_notification(service['workerId'], 'Contraoferta aceptada',
                                   f'{current_user["name"]} ha aceptado tu contraoferta',
                                   'negotiation_accepted', service_id)
            
        elif action == 'complete' and service['status'] == 'accepted':
            service['status'] = 'completed'
            
            # Notificar al trabajador
            if service['workerId']:
                create_notification(service['workerId'], 'Servicio completado',
                                   f'El cliente ha marcado como completado: {service["title"]}',
                                   'service_completed', service_id)
        else:
            return jsonify({'error': 'Acción no válida'}), 400
        
        service['updatedAt'] = datetime.now().isoformat()
        db['serviceRequests'][service_index] = service
        write_db(db)
        
        return jsonify({'success': True, 'service': service})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# API - FAVORITOS
@app.route('/api/favorites', methods=['GET'])
@jwt_required()
def get_favorites():
    try:
        current_user = get_jwt_identity()
        db = read_db()
        favorites = [f for f in db.get('favorites', []) if f['userId'] == current_user['id']]
        return jsonify(favorites)
    except:
        return jsonify([])

@app.route('/api/favorites/<service_id>', methods=['POST'])
@jwt_required()
def add_favorite(service_id):
    try:
        current_user = get_jwt_identity()
        db = read_db()
        
        existing = next((f for f in db.get('favorites', []) 
                        if f['userId'] == current_user['id'] and f['serviceId'] == service_id), None)
        
        if existing:
            return jsonify({'error': 'Ya en favoritos'}), 400
        
        favorite = {
            'id': generate_id(),
            'userId': current_user['id'],
            'serviceId': service_id,
            'createdAt': datetime.now().isoformat()
        }
        
        db.setdefault('favorites', []).append(favorite)
        write_db(db)
        
        return jsonify({'success': True, 'favorite': favorite}), 201
    except:
        return jsonify({'error': 'Error'}), 500

@app.route('/api/favorites/<service_id>', methods=['DELETE'])
@jwt_required()
def remove_favorite(service_id):
    try:
        current_user = get_jwt_identity()
        db = read_db()
        db['favorites'] = [f for f in db.get('favorites', []) 
                          if not (f['userId'] == current_user['id'] and f['serviceId'] == service_id)]
        write_db(db)
        return jsonify({'success': True})
    except:
        return jsonify({'error': 'Error'}), 500


# API - NOTIFICACIONES
@app.route('/api/notifications', methods=['GET'])
@jwt_required()
def get_notifications():
    try:
        current_user = get_jwt_identity()
        notifications = get_user_notifications(current_user['id'])
        return jsonify(notifications)
    except:
        return jsonify([])

@app.route('/api/notifications/<notification_id>/read', methods=['PUT'])
@jwt_required()
def mark_notification_read(notification_id):
    try:
        current_user = get_jwt_identity()
        db = read_db()
        notifications = db.get('notifications', [])
        for n in notifications:
            if n['id'] == notification_id and n['userId'] == current_user['id']:
                n['read'] = True
                break
        write_db(db)
        return jsonify({'success': True})
    except:
        return jsonify({'error': 'Error'}), 500

@app.route('/api/notifications/read-all', methods=['PUT'])
@jwt_required()
def mark_all_read():
    try:
        current_user = get_jwt_identity()
        db = read_db()
        for n in db.get('notifications', []):
            if n['userId'] == current_user['id']:
                n['read'] = True
        write_db(db)
        return jsonify({'success': True})
    except:
        return jsonify({'error': 'Error'}), 500


# API - CHAT MEJORADO
@app.route('/api/chats', methods=['GET'])
@jwt_required()
def get_user_chats():
    try:
        current_user = get_jwt_identity()
        db = read_db()
        
        # Obtener todas las conversaciones del usuario
        user_chats = []
        for chat in db.get('chats', []):
            service = next((s for s in db.get('serviceRequests', []) if s['id'] == chat['serviceId']), None)
            if service and (service['clientId'] == current_user['id'] or service.get('workerId') == current_user['id']):
                other_party_id = service['clientId'] if service['workerId'] == current_user['id'] else service['workerId']
                other_user = next((u for u in db['users'] if u['id'] == other_party_id), None)
                
                user_chats.append({
                    'serviceId': chat['serviceId'],
                    'serviceTitle': service['title'],
                    'otherUserName': other_user['name'] if other_user else 'Usuario',
                    'lastMessage': chat['messages'][-1]['message'] if chat['messages'] else '',
                    'lastMessageTime': chat['messages'][-1]['timestamp'] if chat['messages'] else service['createdAt'],
                    'unreadCount': len([m for m in chat['messages'] if not m.get('read', False) and m['senderId'] != current_user['id']])
                })
        
        user_chats.sort(key=lambda x: x['lastMessageTime'], reverse=True)
        return jsonify(user_chats)
    except:
        return jsonify([])

@app.route('/api/chats/<service_id>', methods=['GET'])
@jwt_required()
def get_chat_messages(service_id):
    try:
        current_user = get_jwt_identity()
        db = read_db()
        
        service = next((s for s in db.get('serviceRequests', []) if s['id'] == service_id), None)
        if not service or (service['clientId'] != current_user['id'] and service.get('workerId') != current_user['id']):
            return jsonify({'error': 'No autorizado'}), 403
        
        chat = next((c for c in db.get('chats', []) if c['serviceId'] == service_id), None)
        
        if chat:
            # Marcar mensajes como leídos
            for msg in chat['messages']:
                if msg['senderId'] != current_user['id']:
                    msg['read'] = True
            write_db(db)
            return jsonify(chat['messages'] if chat else [])
        
        return jsonify([])
    except:
        return jsonify([])

@app.route('/api/chats/<service_id>', methods=['POST'])
@jwt_required()
@limiter.limit("30 per minute")
def send_message(service_id):
    try:
        current_user = get_jwt_identity()
        data = request.json
        message = sanitize_input(data.get('message', ''))
        
        if not message:
            return jsonify({'error': 'Mensaje vacío'}), 400
        
        db = read_db()
        
        service = next((s for s in db.get('serviceRequests', []) if s['id'] == service_id), None)
        if not service or (service['clientId'] != current_user['id'] and service.get('workerId') != current_user['id']):
            return jsonify({'error': 'No autorizado'}), 403
        
        chat_index = next((i for i, c in enumerate(db.get('chats', [])) if c['serviceId'] == service_id), None)
        
        new_message = {
            'id': generate_id(),
            'senderId': current_user['id'],
            'senderName': current_user['name'],
            'senderRole': current_user['role'],
            'message': message,
            'timestamp': datetime.now().isoformat(),
            'read': False
        }
        
        if chat_index is None:
            db.setdefault('chats', []).append({
                'serviceId': service_id,
                'messages': [new_message]
            })
        else:
            db['chats'][chat_index]['messages'].append(new_message)
        
        write_db(db)
        
        # Notificar al otro usuario
        other_user_id = service['clientId'] if current_user['id'] == service.get('workerId') else service.get('workerId')
        if other_user_id:
            create_notification(other_user_id, 'Nuevo mensaje',
                               f'{current_user["name"]} te ha enviado un mensaje',
                               'new_message', service_id)
        
        return jsonify(new_message), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# API - CALIFICACIONES MEJORADAS

@app.route('/api/ratings', methods=['POST'])
@jwt_required()
def create_rating():
    try:
        current_user = get_jwt_identity()
        data = request.json
        service_id = data.get('serviceId')
        rating = data.get('rating')
        comment = sanitize_input(data.get('comment', ''))
        
        if not service_id or not rating or rating < 1 or rating > 5:
            return jsonify({'error': 'Calificación válida requerida (1-5)'}), 400
        
        db = read_db()
        
        service = next((s for s in db.get('serviceRequests', []) if s['id'] == service_id), None)
        if not service or service['clientId'] != current_user['id']:
            return jsonify({'error': 'No autorizado'}), 403
        
        if service['status'] != 'completed':
            return jsonify({'error': 'Solo se pueden calificar servicios completados'}), 400
        
        existing = next((r for r in db.get('ratings', []) if r['serviceId'] == service_id), None)
        if existing:
            return jsonify({'error': 'Este servicio ya fue calificado'}), 400
        
        new_rating = {
            'id': generate_id(),
            'serviceId': service_id,
            'workerId': service['workerId'],
            'clientId': current_user['id'],
            'clientName': current_user['name'],
            'rating': int(rating),
            'comment': comment,
            'workerResponse': None,
            'createdAt': datetime.now().isoformat()
        }
        
        db.setdefault('ratings', []).append(new_rating)
        
        # Actualizar promedio del trabajador
        worker_ratings = [r for r in db['ratings'] if r['workerId'] == service['workerId']]
        avg_rating = sum(r['rating'] for r in worker_ratings) / len(worker_ratings)
        
        user_index = next((i for i, u in enumerate(db['users']) if u['id'] == service['workerId']), None)
        if user_index is not None:
            db['users'][user_index]['rating'] = round(avg_rating, 1)
            db['users'][user_index]['totalRatings'] = len(worker_ratings)
            db['users'][user_index]['completedJobs'] = db['users'][user_index].get('completedJobs', 0) + 1
            
            # Verificar si merece badge de verificado
            if len(worker_ratings) >= 5 and not db['users'][user_index].get('verified', False):
                db['users'][user_index]['verified'] = True
                create_notification(service['workerId'], '¡Felicidades!', 
                                   'Has sido verificado como trabajador confiable.', 'achievement')
        
        write_db(db)
        
        # Notificar al trabajador
        create_notification(service['workerId'], 'Nueva calificación',
                           f'{current_user["name"]} te ha calificado con {rating} estrellas',
                           'new_rating', service_id)
        
        return jsonify({'success': True, 'rating': new_rating}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/ratings/<rating_id>/respond', methods=['PUT'])
@jwt_required()
def respond_to_rating(rating_id):
    try:
        current_user = get_jwt_identity()
        data = request.json
        response = sanitize_input(data.get('response', ''))
        
        db = read_db()
        rating_index = next((i for i, r in enumerate(db.get('ratings', [])) if r['id'] == rating_id), None)
        
        if rating_index is None:
            return jsonify({'error': 'Calificación no encontrada'}), 404
        
        rating = db['ratings'][rating_index]
        
        if rating['workerId'] != current_user['id']:
            return jsonify({'error': 'No autorizado'}), 403
        
        rating['workerResponse'] = response
        db['ratings'][rating_index] = rating
        write_db(db)
        
        return jsonify({'success': True, 'rating': rating})
    except:
        return jsonify({'error': 'Error'}), 500

@app.route('/api/ratings/worker/<worker_id>', methods=['GET'])
def get_worker_ratings(worker_id):
    try:
        db = read_db()
        ratings = [r for r in db.get('ratings', []) if r['workerId'] == worker_id]
        return jsonify(ratings)
    except:
        return jsonify([])


# API - PERFIL DE USUARIO MEJORADO

@app.route('/api/users/<user_id>', methods=['GET'])
def get_user_profile(user_id):
    try:
        db = read_db()
        user = next((u for u in db['users'] if u['id'] == user_id), None)
        
        if not user:
            return jsonify({'error': 'Usuario no encontrado'}), 404
        
        ratings = [r for r in db.get('ratings', []) if r['workerId'] == user_id]
        
        # Calcular calificación por categoría
        category_ratings = {}
        for rating in ratings:
            service = next((s for s in db.get('serviceRequests', []) if s['id'] == rating['serviceId']), None)
            if service:
                cat = service['category']
                if cat not in category_ratings:
                    category_ratings[cat] = {'sum': 0, 'count': 0}
                category_ratings[cat]['sum'] += rating['rating']
                category_ratings[cat]['count'] += 1
        
        for cat in category_ratings:
            category_ratings[cat] = round(category_ratings[cat]['sum'] / category_ratings[cat]['count'], 1)
        
        return jsonify({
            'id': user['id'],
            'name': user['name'],
            'role': user['role'],
            'avatar': user.get('avatar', user['name'][0].upper()),
            'photoUrl': user.get('photoUrl', None),
            'description': user.get('description', ''),
            'rating': user.get('rating', 0),
            'totalRatings': user.get('totalRatings', 0),
            'completedJobs': user.get('completedJobs', 0),
            'responseRate': user.get('responseRate', 100),
            'verified': user.get('verified', False),
            'skills': user.get('skills', []),
            'phone': user.get('phone', ''),
            'createdAt': user.get('createdAt', ''),
            'categoryRatings': category_ratings
        })
    except:
        return jsonify({'error': 'Error'}), 500

@app.route('/api/users/<user_id>', methods=['PUT'])
@jwt_required()
def update_user_profile(user_id):
    try:
        current_user = get_jwt_identity()
        
        if current_user['id'] != user_id:
            return jsonify({'error': 'No autorizado'}), 403
        
        data = request.json
        db = read_db()
        user_index = next((i for i, u in enumerate(db['users']) if u['id'] == user_id), None)
        
        if user_index is None:
            return jsonify({'error': 'Usuario no encontrado'}), 404
        
        user = db['users'][user_index]
        
        # Actualizar campos permitidos
        if 'phone' in data:
            user['phone'] = sanitize_input(data['phone'])
        if 'description' in data:
            user['description'] = sanitize_input(data['description'])
        if 'skills' in data and user['role'] == 'trabajador':
            user['skills'] = data['skills']
        if 'avatar' in data:
            user['avatar'] = sanitize_input(data['avatar'])
        
        db['users'][user_index] = user
        write_db(db)
        
        user_data = {k: v for k, v in user.items() if k != 'password'}
        return jsonify({'success': True, 'user': user_data})
    except:
        return jsonify({'error': 'Error'}), 500


# API - ESTADÍSTICAS Y ANALYTICS


@app.route('/api/stats', methods=['GET'])
def get_stats():
    try:
        db = read_db()
        users = db.get('users', [])
        services = db.get('serviceRequests', [])
        ratings = db.get('ratings', [])
        
        # Estadísticas mensuales
        monthly_services = {}
        for service in services:
            month = service['createdAt'][:7]
            monthly_services[month] = monthly_services.get(month, 0) + 1
        
        # Estadísticas por categoría
        category_stats = {}
        for service in services:
            cat = service['category']
            category_stats[cat] = category_stats.get(cat, 0) + 1
        
        avg_rating = round(sum(r['rating'] for r in ratings) / len(ratings), 1) if ratings else 0
        
        return jsonify({
            'totalUsers': len(users),
            'totalWorkers': len([u for u in users if u['role'] == 'trabajador']),
            'totalClients': len([u for u in users if u['role'] == 'cliente']),
            'totalServices': len(services),
            'activeServices': len([s for s in services if s['status'] in ['pending', 'accepted', 'negotiated']]),
            'completedServices': len([s for s in services if s['status'] == 'completed']),
            'completionRate': round(len([s for s in services if s['status'] == 'completed']) / len(services) * 100, 1) if services else 0,
            'averageRating': avg_rating,
            'monthlyServices': monthly_services,
            'categoryStats': category_stats,
            'categories': db.get('categories', [])
        })
    except:
        return jsonify({})

@app.route('/api/stats/user/<user_id>', methods=['GET'])
@jwt_required()
def get_user_stats(user_id):
    try:
        current_user = get_jwt_identity()
        
        if current_user['id'] != user_id:
            return jsonify({'error': 'No autorizado'}), 403
        
        db = read_db()
        
        if current_user['role'] == 'trabajador':
            my_services = [s for s in db.get('serviceRequests', []) if s.get('workerId') == user_id]
            completed = [s for s in my_services if s['status'] == 'completed']
            earnings = sum(s.get('finalPrice', s.get('proposedPrice', 0)) for s in completed)
            
            return jsonify({
                'totalJobs': len(my_services),
                'completedJobs': len(completed),
                'earnings': earnings,
                'responseTime': '24h'
            })
        else:
            my_services = [s for s in db.get('serviceRequests', []) if s['clientId'] == user_id]
            completed = [s for s in my_services if s['status'] == 'completed']
            spent = sum(s.get('finalPrice', s.get('proposedPrice', 0)) for s in completed)
            
            return jsonify({
                'totalServices': len(my_services),
                'completedServices': len(completed),
                'spent': spent
            })
    except:
        return jsonify({})


# INICIAR SERVIDOR
if __name__ == '__main__':
    print("=" * 70)
    print(" HOGARCONNECT - PLATAFORMA PROFESIONAL DE SERVICIOS")
    print(" ODS 8: Trabajo Decente y Crecimiento Económico")
    print("=" * 70)
    print(f" Servidor: http://localhost:{PORT}")
    print(f" Base de datos: {DB_PATH}")
    print(f" JWT activado: Sí")
    print(f" Rate Limiting: Activado")
    print(f" Modo oscuro/claro: Disponible")
    print(f" Notificaciones: Activadas")
    print(f" Sistema de favoritos: Activado")
    print(f" Analytics: Disponible")
    print("=" * 70)
    print(" VERSIÓN PROFESIONAL TOP GLOBAL")
    print("=" * 70)
    
    app.run(host='0.0.0.0', port=PORT, debug=True, threaded=True)