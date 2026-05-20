// ==============================================
// HOGARCONNECT - APLICACIÓN PROFESIONAL V2.0
// Lógica del cliente con todas las mejoras
// ==============================================

// ========== VARIABLES GLOBALES ==========
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:5000/api' : '/api';
let currentUser = null;
let authToken = null;
let currentServiceId = null;
let selectedRating = 0;
let currentChatServiceId = null;
let notifications = [];
let favorites = [];
let inactivityTimer = null;
let refreshInterval = null;
let currentFilters = {
    category: 'all',
    minPrice: '',
    maxPrice: '',
    sortBy: 'recent',
    search: ''
};

// ========== INICIALIZACIÓN ==========
document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    setupEventListeners();
    await loadStats();
    checkInactivity();
    
    if (loadSavedSession()) {
        await initDashboard();
        await loadNotifications();
        await loadFavorites();
        startActivityMonitoring();
    }
    
    initTheme();
}

// ========== UTILIDADES ==========
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
    };
}

function saveSession(user, token) {
    localStorage.setItem('hogarconnect_user', JSON.stringify(user));
    localStorage.setItem('hogarconnect_token', token);
}

function loadSavedSession() {
    const user = localStorage.getItem('hogarconnect_user');
    const token = localStorage.getItem('hogarconnect_token');
    if (user && token) {
        currentUser = JSON.parse(user);
        authToken = token;
        return true;
    }
    return false;
}

// ========== MODO OSCURO/CLARO ==========
function initTheme() {
    const savedTheme = localStorage.getItem('hogarconnect_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeToggle(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('hogarconnect_theme', newTheme);
    updateThemeToggle(newTheme);
}

function updateThemeToggle(theme) {
    const lightBtn = document.getElementById('theme-light');
    const darkBtn = document.getElementById('theme-dark');
    if (lightBtn && darkBtn) {
        if (theme === 'dark') {
            lightBtn.classList.remove('active');
            darkBtn.classList.add('active');
        } else {
            lightBtn.classList.add('active');
            darkBtn.classList.remove('active');
        }
    }
}

// ========== MONITOREO DE INACTIVIDAD ==========
function checkInactivity() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(async () => {
        if (currentUser) {
            try {
                const response = await fetch(`${API_URL}/auth/check-session`, {
                    headers: getAuthHeaders()
                });
                const data = await response.json();
                if (data.logout) {
                    showToast('Sesión expirada por inactividad', 'warning');
                    logout();
                }
            } catch (error) {
                console.error('Error checking session:', error);
            }
        }
    }, 30 * 60 * 1000);
}

function startActivityMonitoring() {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(event => {
        document.addEventListener(event, checkInactivity);
    });
}

// ========== AUTENTICACIÓN ==========
async function registerUser(event) {
    event.preventDefault();
    
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const phone = document.getElementById('reg-phone').value;
    const password = document.getElementById('reg-password').value;
    const role = document.getElementById('reg-role').value;
    const skillsInput = document.getElementById('reg-skills').value;
    const skills = skillsInput ? skillsInput.split(',').map(s => s.trim()) : [];
    
    if (password.length < 6) {
        showToast('La contraseña debe tener al menos 6 caracteres', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, phone, password, role, skills })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Error en el registro');
        
        currentUser = data.user;
        authToken = data.token;
        saveSession(currentUser, authToken);
        
        showToast(`¡Bienvenido a HogarConnect, ${currentUser.name}!`, 'success');
        await initDashboard();
        await loadNotifications();
        await loadFavorites();
        
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function loginUser(event) {
    event.preventDefault();
    
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Error en el inicio de sesión');
        
        currentUser = data.user;
        authToken = data.token;
        saveSession(currentUser, authToken);
        
        showToast(`¡Bienvenido de vuelta, ${currentUser.name}!`, 'success');
        await initDashboard();
        await loadNotifications();
        await loadFavorites();
        startActivityMonitoring();
        
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function logout() {
    try {
        await fetch(`${API_URL}/auth/logout`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
    } catch (error) {
        console.error('Logout error:', error);
    }
    
    localStorage.removeItem('hogarconnect_user');
    localStorage.removeItem('hogarconnect_token');
    currentUser = null;
    authToken = null;
    
    if (refreshInterval) clearInterval(refreshInterval);
    
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('auth-container').style.display = 'flex';
    showToast('Sesión cerrada correctamente', 'success');
}

// ========== NOTIFICACIONES ==========
async function loadNotifications() {
    try {
        const response = await fetch(`${API_URL}/notifications`, {
            headers: getAuthHeaders()
        });
        notifications = await response.json();
        updateNotificationBadge();
        renderNotifications();
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

function updateNotificationBadge() {
    const unreadCount = notifications.filter(n => !n.read).length;
    const badge = document.getElementById('notification-badge');
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}

function renderNotifications() {
    const container = document.getElementById('notification-list');
    if (!container) return;
    
    if (notifications.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-bell-slash"></i><p>No hay notificaciones</p></div>';
        return;
    }
    
    container.innerHTML = notifications.map(notif => `
        <div class="notification-item ${!notif.read ? 'unread' : ''}" data-id="${notif.id}">
            <div class="notification-icon">
                <i class="fas ${getNotificationIcon(notif.type)}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-title">${escapeHtml(notif.title)}</div>
                <div class="notification-message">${escapeHtml(notif.message)}</div>
                <div class="notification-time">${formatTime(notif.createdAt)}</div>
            </div>
        </div>
    `).join('');
}

function getNotificationIcon(type) {
    const icons = {
        'welcome': 'fa-handshake',
        'new_service': 'fa-plus-circle',
        'service_accepted': 'fa-check-circle',
        'negotiation': 'fa-exchange-alt',
        'negotiation_accepted': 'fa-check-double',
        'service_completed': 'fa-star',
        'new_message': 'fa-comment',
        'new_rating': 'fa-star',
        'achievement': 'fa-trophy'
    };
    return icons[type] || 'fa-bell';
}

function formatTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Hace un momento';
    if (diff < 3600000) return `Hace ${Math.floor(diff / 60000)} minutos`;
    if (diff < 86400000) return `Hace ${Math.floor(diff / 3600000)} horas`;
    return date.toLocaleDateString();
}

async function markNotificationRead(notificationId) {
    try {
        await fetch(`${API_URL}/notifications/${notificationId}/read`, {
            method: 'PUT',
            headers: getAuthHeaders()
        });
        await loadNotifications();
    } catch (error) {
        console.error('Error marking notification read:', error);
    }
}

async function markAllNotificationsRead() {
    try {
        await fetch(`${API_URL}/notifications/read-all`, {
            method: 'PUT',
            headers: getAuthHeaders()
        });
        await loadNotifications();
    } catch (error) {
        console.error('Error marking all read:', error);
    }
}

function toggleNotificationDropdown() {
    const dropdown = document.getElementById('notification-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
        if (dropdown.classList.contains('show')) {
            renderNotifications();
        }
    }
}

// ========== FAVORITOS ==========
async function loadFavorites() {
    try {
        const response = await fetch(`${API_URL}/favorites`, {
            headers: getAuthHeaders()
        });
        favorites = await response.json();
    } catch (error) {
        console.error('Error loading favorites:', error);
    }
}

function isFavorite(serviceId) {
    return favorites.some(f => f.serviceId === serviceId);
}

async function toggleFavorite(serviceId, buttonElement) {
    try {
        let response;
        if (isFavorite(serviceId)) {
            response = await fetch(`${API_URL}/favorites/${serviceId}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
            favorites = favorites.filter(f => f.serviceId !== serviceId);
            showToast('Eliminado de favoritos', 'info');
        } else {
            response = await fetch(`${API_URL}/favorites/${serviceId}`, {
                method: 'POST',
                headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                favorites.push({ serviceId, id: data.favorite?.id });
                showToast('Añadido a favoritos', 'success');
            }
        }
        
        if (buttonElement) {
            if (isFavorite(serviceId)) {
                buttonElement.classList.add('active');
                buttonElement.innerHTML = '<i class="fas fa-heart"></i>';
            } else {
                buttonElement.classList.remove('active');
                buttonElement.innerHTML = '<i class="far fa-heart"></i>';
            }
        }
    } catch (error) {
        showToast('Error al procesar favorito', 'error');
    }
}

// ========== SERVICIOS ==========
async function publishService() {
    const title = document.getElementById('service-title').value;
    const description = document.getElementById('service-desc').value;
    const location = document.getElementById('service-location').value;
    const category = document.getElementById('service-category').value;
    const proposedPrice = parseFloat(document.getElementById('service-price').value);
    
    if (!title || !description || !location || !proposedPrice) {
        showToast('Complete todos los campos', 'error');
        return;
    }
    
    // Intentar obtener geolocalización
    let locationData = location;
    if (navigator.geolocation) {
        try {
            const position = await getCurrentPosition();
            locationData = {
                address: location,
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
        } catch (error) {
            console.log('Geolocalización no disponible o denegada');
        }
    }
    
    try {
        const response = await fetch(`${API_URL}/services`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ 
                title, description, location: locationData, category, proposedPrice 
            })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Error al publicar');
        
        showToast('Servicio publicado exitosamente', 'success');
        
        document.getElementById('publish-form').style.display = 'none';
        document.getElementById('service-title').value = '';
        document.getElementById('service-desc').value = '';
        document.getElementById('service-location').value = '';
        document.getElementById('service-price').value = '';
        
        await loadMarketplace();
        await loadMyServices();
        
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        });
    });
}

async function loadMarketplace() {
    if (currentUser.role !== 'trabajador') {
        document.getElementById('services-list').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-info-circle"></i>
                <p>Como cliente, tus servicios aparecen en "Mis Servicios"</p>
            </div>
        `;
        return;
    }
    
    showSkeleton('services-list', 3);
    
    try {
        const params = new URLSearchParams(currentFilters);
        const response = await fetch(`${API_URL}/services?${params}`, {
            headers: getAuthHeaders()
        });
        const services = await response.json();
        if (!response.ok) throw new Error('Error al cargar');
        renderServicesList(services, 'marketplace');
    } catch (error) {
        showToast(error.message, 'error');
        document.getElementById('services-list').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Error al cargar servicios</p>
            </div>
        `;
    }
}

async function loadMyServices() {
    showSkeleton('my-services-list', 3);
    
    try {
        const response = await fetch(`${API_URL}/services`, {
            headers: getAuthHeaders()
        });
        const services = await response.json();
        if (!response.ok) throw new Error('Error al cargar');
        renderServicesList(services, 'mis-servicios');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function showSkeleton(containerId, count) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        container.innerHTML += `
            <div class="service-card">
                <div class="service-card-header">
                    <div>
                        <div class="skeleton skeleton-title"></div>
                        <div class="skeleton skeleton-text" style="width: 60%;"></div>
                    </div>
                </div>
                <div class="service-card-body">
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text" style="width: 80%;"></div>
                </div>
            </div>
        `;
    }
}

function renderServicesList(services, type) {
    const container = document.getElementById(type === 'marketplace' ? 'services-list' : 'my-services-list');
    
    if (!services || services.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>No hay servicios disponibles</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = services.map(service => createServiceCard(service, type)).join('');
}

function createServiceCard(service, type) {
    const statusClass = `status-${service.status}`;
    const statusText = {
        'pending': 'Pendiente',
        'accepted': 'Aceptado',
        'negotiated': 'Negociación',
        'completed': 'Completado'
    }[service.status] || service.status;
    
    const isFav = isFavorite(service.id);
    const favoriteIcon = isFav ? '<i class="fas fa-heart"></i>' : '<i class="far fa-heart"></i>';
    
    let locationDisplay = '';
    if (service.location) {
        if (typeof service.location === 'object') {
            locationDisplay = `<span><i class="fas fa-map-marker-alt"></i> ${escapeHtml(service.location.address?.substring(0, 50) || 'Ubicación')}</span>`;
        } else {
            locationDisplay = `<span><i class="fas fa-map-marker-alt"></i> ${escapeHtml(service.location.substring(0, 50))}</span>`;
        }
    }
    
    let actions = '';
    
    if (type === 'marketplace' && currentUser.role === 'trabajador' && service.status === 'pending') {
        actions = `
            <div class="service-card-footer">
                <button class="btn-primary accept-service" data-id="${service.id}">
                    <i class="fas fa-check"></i> Aceptar
                </button>
                <button class="btn-secondary negotiate-service" data-id="${service.id}">
                    <i class="fas fa-exchange-alt"></i> Negociar
                </button>
            </div>
        `;
    } else if (type === 'mis-servicios') {
        if (currentUser.role === 'cliente') {
            if (service.status === 'negotiated') {
                actions = `
                    <div class="service-card-footer">
                        <button class="btn-primary accept-negotiation" data-id="${service.id}">
                            <i class="fas fa-check"></i> Aceptar Contraoferta
                        </button>
                        <button class="btn-secondary open-chat" data-id="${service.id}">
                            <i class="fas fa-comments"></i> Chat
                        </button>
                    </div>
                `;
            } else if (service.status === 'accepted') {
                actions = `
                    <div class="service-card-footer">
                        <button class="btn-primary complete-service" data-id="${service.id}">
                            <i class="fas fa-check-double"></i> Completar
                        </button>
                        <button class="btn-secondary open-chat" data-id="${service.id}">
                            <i class="fas fa-comments"></i> Chat
                        </button>
                    </div>
                `;
            } else if (service.status === 'completed') {
                actions = `
                    <div class="service-card-footer">
                        <button class="btn-primary rate-service" data-id="${service.id}">
                            <i class="fas fa-star"></i> Calificar
                        </button>
                        <button class="btn-secondary open-chat" data-id="${service.id}">
                            <i class="fas fa-comments"></i> Chat
                        </button>
                    </div>
                `;
            } else {
                actions = `
                    <div class="service-card-footer">
                        <button class="btn-secondary open-chat" data-id="${service.id}">
                            <i class="fas fa-comments"></i> Chat
                        </button>
                    </div>
                `;
            }
        } else if (currentUser.role === 'trabajador' && (service.status === 'accepted' || service.status === 'negotiated')) {
            actions = `
                <div class="service-card-footer">
                    <button class="btn-secondary open-chat" data-id="${service.id}">
                        <i class="fas fa-comments"></i> Chat
                    </button>
                </div>
            `;
        }
    }
    
    return `
        <div class="service-card">
            <div class="service-card-header">
                <div>
                    <div class="service-title">${escapeHtml(service.title)}</div>
                    <span class="service-category">${service.category}</span>
                </div>
                <button class="favorite-btn ${isFav ? 'active' : ''}" data-id="${service.id}">
                    ${favoriteIcon}
                </button>
            </div>
            <div class="service-card-body">
                <div class="service-status ${statusClass}">${statusText}</div>
                <div class="service-description">${escapeHtml(service.description.substring(0, 120))}${service.description.length > 120 ? '...' : ''}</div>
                <div class="service-details">
                    ${locationDisplay}
                    <span><i class="fas fa-user"></i> ${escapeHtml(service.clientName)}</span>
                </div>
                <div class="service-price">
                    ${service.finalPrice ? `$${service.finalPrice.toLocaleString()}` : `$${service.proposedPrice.toLocaleString()}`}
                </div>
            </div>
            ${actions}
        </div>
    `;
}

// ========== ACCIONES DE SERVICIOS ==========
async function acceptService(serviceId) {
    try {
        const response = await fetch(`${API_URL}/services/${serviceId}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action: 'accept' })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        showToast('Servicio aceptado', 'success');
        await loadMarketplace();
        await loadMyServices();
        await loadNotifications();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function negotiateService(serviceId) {
    const counterOffer = prompt('Ingrese su contraoferta:');
    if (!counterOffer || isNaN(counterOffer)) {
        showToast('Precio inválido', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/services/${serviceId}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action: 'negotiate', counterOffer: parseFloat(counterOffer) })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        showToast(`Contraoferta de $${counterOffer} enviada`, 'success');
        await loadMarketplace();
        await loadMyServices();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function acceptNegotiation(serviceId) {
    try {
        const response = await fetch(`${API_URL}/services/${serviceId}/client`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action: 'accept_negotiation' })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        showToast('Contraoferta aceptada', 'success');
        await loadMyServices();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function completeService(serviceId) {
    if (!confirm('¿Confirmas que el servicio ha sido completado satisfactoriamente?')) return;
    
    try {
        const response = await fetch(`${API_URL}/services/${serviceId}/client`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action: 'complete' })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        showToast('Servicio completado', 'success');
        await loadMyServices();
        await loadNotifications();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ========== FILTROS AVANZADOS ==========
function applyFilters() {
    currentFilters = {
        category: document.getElementById('filter-category')?.value || 'all',
        minPrice: document.getElementById('filter-min-price')?.value || '',
        maxPrice: document.getElementById('filter-max-price')?.value || '',
        sortBy: document.getElementById('filter-sort')?.value || 'recent',
        search: document.getElementById('search-input')?.value || ''
    };
    loadMarketplace();
}

function resetFilters() {
    currentFilters = {
        category: 'all',
        minPrice: '',
        maxPrice: '',
        sortBy: 'recent',
        search: ''
    };
    
    const categorySelect = document.getElementById('filter-category');
    const minPriceInput = document.getElementById('filter-min-price');
    const maxPriceInput = document.getElementById('filter-max-price');
    const sortSelect = document.getElementById('filter-sort');
    const searchInput = document.getElementById('search-input');
    
    if (categorySelect) categorySelect.value = 'all';
    if (minPriceInput) minPriceInput.value = '';
    if (maxPriceInput) maxPriceInput.value = '';
    if (sortSelect) sortSelect.value = 'recent';
    if (searchInput) searchInput.value = '';
    
    loadMarketplace();
}

// ========== CHAT MEJORADO ==========
async function openChat(serviceId) {
    currentChatServiceId = serviceId;
    const modal = document.getElementById('chat-modal');
    modal.classList.add('show');
    
    await loadChatMessages();
    await loadConversations();
    
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
        if (currentChatServiceId) loadChatMessages();
    }, 3000);
}

async function loadConversations() {
    try {
        const response = await fetch(`${API_URL}/chats`, {
            headers: getAuthHeaders()
        });
        const conversations = await response.json();
        renderConversations(conversations);
    } catch (error) {
        console.error('Error loading conversations:', error);
    }
}

function renderConversations(conversations) {
    const sidebar = document.getElementById('chat-sidebar');
    if (!sidebar) return;
    
    if (!conversations || conversations.length === 0) {
        sidebar.innerHTML = '<div class="empty-state"><p>No hay conversaciones</p></div>';
        return;
    }
    
    sidebar.innerHTML = conversations.map(conv => `
        <div class="chat-conversation-item ${conv.serviceId === currentChatServiceId ? 'active' : ''}" 
             data-service-id="${conv.serviceId}">
            <div class="chat-name">${escapeHtml(conv.otherUserName)}</div>
            <div class="chat-last-message">${escapeHtml(conv.lastMessage?.substring(0, 50) || '')}</div>
            <div class="chat-time">${formatTime(conv.lastMessageTime)}</div>
            ${conv.unreadCount > 0 ? `<span class="notification-badge" style="position: static; display: inline-block; margin-top: 4px;">${conv.unreadCount}</span>` : ''}
        </div>
    `).join('');
    
    document.querySelectorAll('.chat-conversation-item').forEach(item => {
        item.addEventListener('click', () => {
            currentChatServiceId = item.dataset.serviceId;
            loadChatMessages();
            loadConversations();
        });
    });
}

async function loadChatMessages() {
    if (!currentChatServiceId) return;
    
    try {
        const response = await fetch(`${API_URL}/chats/${currentChatServiceId}`, {
            headers: getAuthHeaders()
        });
        const messages = await response.json();
        renderChatMessages(messages);
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

function renderChatMessages(messages) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    if (!messages || messages.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No hay mensajes aún. ¡Envía el primer mensaje!</p></div>';
        return;
    }
    
    container.innerHTML = messages.map(msg => `
        <div class="chat-message ${msg.senderId === currentUser.id ? 'chat-message-own' : 'chat-message-other'}">
            <div class="chat-message-sender">${escapeHtml(msg.senderName)}</div>
            <div class="chat-message-bubble">${escapeHtml(msg.message)}</div>
            <div class="chat-message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
        </div>
    `).join('');
    
    container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('chat-message-input');
    const message = input.value.trim();
    
    if (!message || !currentChatServiceId) return;
    
    try {
        const response = await fetch(`${API_URL}/chats/${currentChatServiceId}`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ message })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        
        input.value = '';
        await loadChatMessages();
        await loadConversations();
        
        // Indicador de escritura (simulado)
        showTypingIndicator();
        
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function showTypingIndicator() {
    const container = document.getElementById('chat-messages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-typing';
    typingDiv.innerHTML = '<i class="fas fa-ellipsis-h"></i> Escribiendo...';
    container.appendChild(typingDiv);
    setTimeout(() => typingDiv.remove(), 1500);
}

// ========== CALIFICACIONES ==========
function openRatingModal(serviceId) {
    currentServiceId = serviceId;
    selectedRating = 0;
    const modal = document.getElementById('rating-modal');
    modal.classList.add('show');
    
    document.querySelectorAll('.rating-stars i').forEach(star => {
        star.classList.remove('active', 'fas');
        star.classList.add('far');
    });
    document.getElementById('rating-comment').value = '';
}

async function submitRating() {
    if (selectedRating === 0) {
        showToast('Selecciona una calificación', 'error');
        return;
    }
    
    const comment = document.getElementById('rating-comment').value;
    
    try {
        const response = await fetch(`${API_URL}/ratings`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ serviceId: currentServiceId, rating: selectedRating, comment })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        
        showToast('¡Gracias por tu calificación!', 'success');
        document.getElementById('rating-modal').classList.remove('show');
        await loadMyServices();
        await loadProfile();
        
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ========== PERFIL DE USUARIO ==========
async function loadProfile() {
    try {
        const response = await fetch(`${API_URL}/users/${currentUser.id}`);
        const profile = await response.json();
        
        const statsResponse = await fetch(`${API_URL}/stats/user/${currentUser.id}`, {
            headers: getAuthHeaders()
        });
        const userStats = await statsResponse.json();
        
        const ratingsResponse = await fetch(`${API_URL}/ratings/worker/${currentUser.id}`);
        const ratings = await ratingsResponse.json();
        
        renderProfile(profile, userStats, ratings);
        
    } catch (error) {
        showToast('Error al cargar perfil', 'error');
    }
}

function renderProfile(profile, userStats, ratings) {
    const container = document.getElementById('profile-content');
    
    container.innerHTML = `
        <div class="profile-header">
            <div class="profile-avatar-large">
                ${profile.avatar || profile.name.charAt(0).toUpperCase()}
            </div>
            <div class="profile-name">${escapeHtml(profile.name)}</div>
            <div class="profile-role">${profile.role === 'cliente' ? 'Cliente' : 'Trabajador'}</div>
            ${profile.verified ? '<span class="service-category"><i class="fas fa-check-circle"></i> Verificado</span>' : ''}
            
            <div class="profile-stats">
                <div class="profile-stat">
                    <div class="profile-stat-value">${profile.rating || 0}</div>
                    <div class="profile-stat-label">Calificación</div>
                </div>
                <div class="profile-stat">
                    <div class="profile-stat-value">${profile.totalRatings || 0}</div>
                    <div class="profile-stat-label">Opiniones</div>
                </div>
                <div class="profile-stat">
                    <div class="profile-stat-value">${profile.completedJobs || 0}</div>
                    <div class="profile-stat-label">Trabajos</div>
                </div>
            </div>
        </div>
        
        <div class="profile-card">
            <div class="profile-card-title">Información de contacto</div>
            <div class="profile-field">
                <div class="profile-field-label">Email</div>
                <div class="profile-field-value">${escapeHtml(currentUser.email)}</div>
            </div>
            <div class="profile-field">
                <div class="profile-field-label">Teléfono</div>
                <div class="profile-field-value">${escapeHtml(profile.phone || 'No registrado')}</div>
            </div>
            <div class="profile-field">
                <div class="profile-field-label">Miembro desde</div>
                <div class="profile-field-value">${new Date(profile.createdAt).toLocaleDateString()}</div>
            </div>
        </div>
        
        ${profile.role === 'trabajador' ? `
            <div class="profile-card">
                <div class="profile-card-title">Habilidades</div>
                <div class="profile-field-value">
                    ${profile.skills?.length ? profile.skills.map(s => `<span class="service-category">${escapeHtml(s)}</span>`).join(' ') : 'No especificadas'}
                </div>
            </div>
            
            <div class="profile-card">
                <div class="profile-card-title">Estadísticas profesionales</div>
                <div class="profile-field">
                    <div class="profile-field-label">Tasa de respuesta</div>
                    <div class="profile-field-value">${profile.responseRate || 100}%</div>
                </div>
                <div class="profile-field">
                    <div class="profile-field-label">Ingresos totales</div>
                    <div class="profile-field-value">$${(userStats.earnings || 0).toLocaleString()}</div>
                </div>
            </div>
        ` : `
            <div class="profile-card">
                <div class="profile-card-title">Estadísticas</div>
                <div class="profile-field">
                    <div class="profile-field-label">Servicios publicados</div>
                    <div class="profile-field-value">${userStats.totalServices || 0}</div>
                </div>
                <div class="profile-field">
                    <div class="profile-field-label">Gastado en servicios</div>
                    <div class="profile-field-value">$${(userStats.spent || 0).toLocaleString()}</div>
                </div>
            </div>
        `}
        
        ${ratings.length > 0 ? `
            <div class="profile-card">
                <div class="profile-card-title">Opiniones recientes</div>
                ${ratings.slice(0, 3).map(r => `
                    <div class="profile-field">
                        <div class="profile-field-value">
                            ${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}
                            <span style="font-size: 0.75rem; color: var(--text-muted);"> - ${new Date(r.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div class="profile-field-value" style="font-size: 0.8125rem;">"${escapeHtml(r.comment)}"</div>
                        ${r.workerResponse ? `<div class="profile-field-value" style="font-size: 0.75rem; color: var(--accent);">Respuesta: ${escapeHtml(r.workerResponse)}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        ` : ''}
    `;
}

// ========== ESTADÍSTICAS Y ANALYTICS ==========
async function loadStats() {
    try {
        const response = await fetch(`${API_URL}/stats`);
        const stats = await response.json();
        
        const usersEl = document.getElementById('stat-users');
        const servicesEl = document.getElementById('stat-services');
        const ratingEl = document.getElementById('stat-rating');
        
        if (usersEl) usersEl.textContent = stats.totalUsers || 0;
        if (servicesEl) servicesEl.textContent = stats.totalServices || 0;
        if (ratingEl) ratingEl.textContent = stats.averageRating || 0;
        
        // Renderizar gráficos si Chart.js está disponible
        if (typeof Chart !== 'undefined') {
            renderCharts(stats);
        }
        
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function renderCharts(stats) {
    // Gráfico de servicios mensuales
    const monthlyCtx = document.getElementById('monthly-chart');
    if (monthlyCtx && stats.monthlyServices) {
        const months = Object.keys(stats.monthlyServices);
        const counts = Object.values(stats.monthlyServices);
        
        new Chart(monthlyCtx, {
            type: 'line',
            data: {
                labels: months,
                datasets: [{
                    label: 'Servicios por mes',
                    data: counts,
                    borderColor: '#c6a43f',
                    backgroundColor: 'rgba(198, 164, 63, 0.1)',
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    }
    
    // Gráfico de categorías
    const categoryCtx = document.getElementById('category-chart');
    if (categoryCtx && stats.categoryStats) {
        const categories = Object.keys(stats.categoryStats);
        const counts = Object.values(stats.categoryStats);
        
        new Chart(categoryCtx, {
            type: 'doughnut',
            data: {
                labels: categories,
                datasets: [{
                    data: counts,
                    backgroundColor: ['#c6a43f', '#10b981', '#3b82f6', '#ef4444', '#f59e0b', '#8b5cf6']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    }
}

// ========== TOUR GUIADO ==========
function startTour() {
    const tourSteps = [
        { element: '.main-nav', title: 'Navegación', content: 'Accede a Marketplace, Mis Servicios y Perfil' },
        { element: '#show-publish-btn', title: 'Publicar Servicio', content: 'Publica tu servicio para que trabajadores lo vean' },
        { element: '.filters-bar', title: 'Filtros', content: 'Filtra servicios por categoría, precio y más' },
        { element: '.notification-bell', title: 'Notificaciones', content: 'Recibe alertas cuando algo importante ocurra' }
    ];
    
    let currentStep = 0;
    
    function showStep(step) {
        const stepData = tourSteps[step];
        const element = document.querySelector(stepData.element);
        if (!element) return;
        
        const rect = element.getBoundingClientRect();
        const overlay = document.getElementById('tour-overlay');
        const tourStep = document.getElementById('tour-step');
        
        overlay.style.display = 'block';
        tourStep.style.display = 'block';
        tourStep.style.top = `${rect.bottom + 10}px`;
        tourStep.style.left = `${rect.left}px`;
        
        document.getElementById('tour-title').textContent = stepData.title;
        document.getElementById('tour-content').textContent = stepData.content;
    }
    
    showStep(0);
    
    document.getElementById('tour-next').onclick = () => {
        currentStep++;
        if (currentStep < tourSteps.length) {
            showStep(currentStep);
        } else {
            endTour();
        }
    };
    
    document.getElementById('tour-end').onclick = endTour;
    
    function endTour() {
        document.getElementById('tour-overlay').style.display = 'none';
        document.getElementById('tour-step').style.display = 'none';
    }
}

// ========== NAVEGACIÓN Y DASHBOARD ==========
function switchView(viewName) {
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    document.getElementById(`${viewName}-view`).classList.add('active');
    
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    document.querySelector(`.nav-link[data-view="${viewName}"]`).classList.add('active');
    
    if (viewName === 'marketplace') {
        loadMarketplace();
        renderFilters();
    } else if (viewName === 'mis-servicios') {
        loadMyServices();
    } else if (viewName === 'perfil') {
        loadProfile();
    } else if (viewName === 'favoritos') {
        loadFavoritesView();
    } else if (viewName === 'analytics') {
        loadAnalytics();
    }
}

function renderFilters() {
    const categories = ['Plomería', 'Electricidad', 'Limpieza', 'Carpintería', 'Jardinería', 'Pintura', 'Mudanzas', 'General'];
    const select = document.getElementById('filter-category');
    if (select && select.children.length <= 1) {
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            select.appendChild(option);
        });
    }
}

async function loadFavoritesView() {
    const container = document.getElementById('favorites-list');
    if (!container) return;
    
    if (favorites.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-heart"></i><p>No tienes servicios favoritos</p></div>';
        return;
    }
    
    const serviceIds = favorites.map(f => f.serviceId);
    const allServices = await fetch(`${API_URL}/services`, { headers: getAuthHeaders() }).then(r => r.json());
    const favServices = allServices.filter(s => serviceIds.includes(s.id));
    
    renderServicesList(favServices, 'favoritos');
}

async function loadAnalytics() {
    const response = await fetch(`${API_URL}/stats`);
    const stats = await response.json();
    
    document.getElementById('analytics-container').innerHTML = `
        <div class="stats-grid">
            <div class="stat-widget">
                <div class="stat-widget-value">${stats.totalUsers || 0}</div>
                <div class="stat-widget-label">Usuarios totales</div>
            </div>
            <div class="stat-widget">
                <div class="stat-widget-value">${stats.totalServices || 0}</div>
                <div class="stat-widget-label">Servicios totales</div>
            </div>
            <div class="stat-widget">
                <div class="stat-widget-value">${stats.completionRate || 0}%</div>
                <div class="stat-widget-label">Tasa de completado</div>
            </div>
            <div class="stat-widget">
                <div class="stat-widget-value">${stats.averageRating || 0}</div>
                <div class="stat-widget-label">Calificación promedio</div>
            </div>
        </div>
        <div class="chart-container">
            <div class="chart-title">Servicios por mes</div>
            <canvas id="monthly-chart" style="height: 300px;"></canvas>
        </div>
        <div class="chart-container">
            <div class="chart-title">Categorías más populares</div>
            <canvas id="category-chart" style="height: 300px;"></canvas>
        </div>
    `;
    
    renderCharts(stats);
}

async function initDashboard() {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    
    document.getElementById('user-name').textContent = currentUser.name;
    document.getElementById('user-role').textContent = currentUser.role === 'cliente' ? 'Cliente' : 'Trabajador';
    
    const avatarEl = document.querySelector('.user-avatar');
    if (avatarEl) {
        avatarEl.innerHTML = currentUser.name.charAt(0).toUpperCase();
    }
    
    const publishBtn = document.getElementById('show-publish-btn');
    if (publishBtn) {
        publishBtn.style.display = currentUser.role === 'cliente' ? 'flex' : 'none';
    }
    
    switchView('marketplace');
}

// ========== EVENT LISTENERS ==========
function setupEventListeners() {
    // Autenticación
    document.getElementById('login-form')?.addEventListener('submit', loginUser);
    document.getElementById('register-form')?.addEventListener('submit', registerUser);
    
    // Tabs de autenticación
    document.querySelectorAll('.form-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            document.querySelectorAll('.form-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
            document.getElementById(`${tabName}-form`).classList.add('active');
        });
    });
    
    // Campo de habilidades
    document.getElementById('reg-role')?.addEventListener('change', (e) => {
        document.getElementById('skills-field').style.display = e.target.value === 'trabajador' ? 'block' : 'none';
    });
    
    // Navegación
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => switchView(link.dataset.view));
    });
    
    // Publicar servicio
    document.getElementById('show-publish-btn')?.addEventListener('click', () => {
        const form = document.getElementById('publish-form');
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('cancel-publish')?.addEventListener('click', () => {
        document.getElementById('publish-form').style.display = 'none';
    });
    document.getElementById('submit-service')?.addEventListener('click', publishService);
    
    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    
    // Notificaciones
    document.getElementById('notification-bell')?.addEventListener('click', toggleNotificationDropdown);
    document.getElementById('mark-all-read')?.addEventListener('click', markAllNotificationsRead);
    
    // Modo oscuro
    document.getElementById('theme-light')?.addEventListener('click', () => toggleTheme('light'));
    document.getElementById('theme-dark')?.addEventListener('click', () => toggleTheme('dark'));
    
    // Filtros
    document.getElementById('apply-filters')?.addEventListener('click', applyFilters);
    document.getElementById('reset-filters')?.addEventListener('click', resetFilters);
    document.getElementById('search-input')?.addEventListener('input', debounce(applyFilters, 500));
    
    // Chat
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('chat-modal')?.classList.remove('show');
            document.getElementById('rating-modal')?.classList.remove('show');
            if (refreshInterval) clearInterval(refreshInterval);
            currentChatServiceId = null;
        });
    });
    document.getElementById('chat-send-btn')?.addEventListener('click', sendMessage);
    document.getElementById('chat-message-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    
    // Calificación
    document.querySelectorAll('.rating-stars i').forEach(star => {
        star.addEventListener('click', () => {
            const rating = parseInt(star.dataset.rating);
            selectedRating = rating;
            document.querySelectorAll('.rating-stars i').forEach(s => {
                const starRating = parseInt(s.dataset.rating);
                if (starRating <= rating) {
                    s.classList.remove('far');
                    s.classList.add('fas', 'active');
                } else {
                    s.classList.remove('fas', 'active');
                    s.classList.add('far');
                }
            });
        });
    });
    document.getElementById('submit-rating')?.addEventListener('click', submitRating);
    
    // Tour
    document.getElementById('start-tour')?.addEventListener('click', startTour);
    
    // Eventos dinámicos
    document.addEventListener('click', async (e) => {
        if (e.target.closest('.accept-service')) {
            acceptService(e.target.closest('.accept-service').dataset.id);
        }
        if (e.target.closest('.negotiate-service')) {
            negotiateService(e.target.closest('.negotiate-service').dataset.id);
        }
        if (e.target.closest('.accept-negotiation')) {
            acceptNegotiation(e.target.closest('.accept-negotiation').dataset.id);
        }
        if (e.target.closest('.complete-service')) {
            completeService(e.target.closest('.complete-service').dataset.id);
        }
        if (e.target.closest('.open-chat')) {
            openChat(e.target.closest('.open-chat').dataset.id);
        }
        if (e.target.closest('.rate-service')) {
            openRatingModal(e.target.closest('.rate-service').dataset.id);
        }
        if (e.target.closest('.favorite-btn')) {
            const btn = e.target.closest('.favorite-btn');
            toggleFavorite(btn.dataset.id, btn);
        }
        if (e.target.closest('.notification-item')) {
            const item = e.target.closest('.notification-item');
            await markNotificationRead(item.dataset.id);
        }
        if (e.target.closest('.chat-conversation-item')) {
            const item = e.target.closest('.chat-conversation-item');
            currentChatServiceId = item.dataset.serviceId;
            await loadChatMessages();
            await loadConversations();
        }
    });
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}