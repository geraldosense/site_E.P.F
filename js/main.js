// Configurações globais
const CONFIG = {
    GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
    API_ENDPOINTS: {
        AUTH: '/api/auth',
        CHECK_EMAIL: '/api/check-email',
        NEWSLETTER: '/api/newsletter'
    },
    VALID_DOMAINS: ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'epfundao.pt'],
    NOTIFICATION_DURATION: 3000,
    SCROLL_THRESHOLD: 100
};

// Utilitários
const Utils = {
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    async fetchWithTimeout(url, options = {}, timeout = 5000) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(id);
            return response;
        } catch (error) {
            clearTimeout(id);
            throw error;
        }
    },

    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },

    sanitizeInput(input) {
        return input.replace(/[<>]/g, '');
    }
};

// Gerenciador de Estado
class StateManager {
    constructor() {
        this.state = {
            isAuthenticated: false,
            userData: null,
            activeModal: null,
            notifications: []
        };
        this.listeners = new Set();
    }

    setState(newState) {
        this.state = { ...this.state, ...newState };
        this.notifyListeners();
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notifyListeners() {
        this.listeners.forEach(listener => listener(this.state));
    }
}

// Gerenciador de Autenticação
class AuthManager {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.emailValidator = new EmailValidator();
        this.initializeGoogleAuth();
    }

    initializeGoogleAuth() {
        google.accounts.id.initialize({
            client_id: CONFIG.GOOGLE_CLIENT_ID,
            callback: this.handleGoogleSignIn.bind(this),
            auto_select: false,
            cancel_on_tap_outside: true
        });
    }

    async handleGoogleSignIn(response) {
        try {
            const payload = JSON.parse(atob(response.credential.split('.')[1]));
            const userData = {
                email: payload.email,
                name: payload.name,
                picture: payload.picture,
                googleId: payload.sub
            };

            const authResponse = await this.authenticateWithBackend(userData);
            
            if (authResponse.success) {
                this.setAuthState(userData, authResponse.token);
                UI.updateForLoggedInUser(userData);
                NotificationManager.show('Login realizado com sucesso!', 'success');
            } else {
                throw new Error(authResponse.message || 'Erro na autenticação');
            }
        } catch (error) {
            console.error('Erro no login com Google:', error);
            NotificationManager.show('Erro ao fazer login com Google. Tente novamente.', 'error');
        }
    }

    async authenticateWithBackend(userData) {
        try {
            const response = await Utils.fetchWithTimeout(CONFIG.API_ENDPOINTS.AUTH + '/google', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content
                },
                body: JSON.stringify(userData)
            });
            
            return await response.json();
        } catch (error) {
            console.error('Erro na autenticação com backend:', error);
            throw error;
        }
    }

    setAuthState(userData, token) {
        localStorage.setItem('authToken', token);
        localStorage.setItem('userData', JSON.stringify(userData));
        this.stateManager.setState({
            isAuthenticated: true,
            userData
        });
    }

    logout() {
        localStorage.removeItem('authToken');
        localStorage.removeItem('userData');
        google.accounts.id.disableAutoSelect();
        
        this.stateManager.setState({
            isAuthenticated: false,
            userData: null
        });
        
        UI.updateForLoggedOutUser();
        this.initializeGoogleAuth();
        NotificationManager.show('Logout realizado com sucesso!', 'success');
    }
}

// Gerenciador de UI
class UI {
    static updateForLoggedInUser(userData) {
        const authButtons = document.querySelector('.auth-buttons');
        if (authButtons) {
            authButtons.innerHTML = `
                <div class="user-profile">
                    <img src="${Utils.sanitizeInput(userData.picture)}" 
                         alt="${Utils.sanitizeInput(userData.name)}" 
                         class="user-avatar">
                    <span class="user-name">${Utils.sanitizeInput(userData.name)}</span>
                    <button onclick="authManager.logout()" class="logout-btn">Sair</button>
                </div>
            `;
        }
    }

    static updateForLoggedOutUser() {
        const authButtons = document.querySelector('.auth-buttons');
        if (authButtons) {
            authButtons.innerHTML = `
                <a href="#login" class="login-btn">Login</a>
                <a href="#registro" class="register-btn">Registar</a>
            `;
        }
    }

    static createModal(type) {
        const modal = new Modal(type);
        return modal;
    }
}

// Gerenciador de Notificações
class NotificationManager {
    static show(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = Utils.sanitizeInput(message);
        
        document.body.appendChild(notification);
        
        requestAnimationFrame(() => notification.classList.add('show'));
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, CONFIG.NOTIFICATION_DURATION);
    }
}

// Classe Modal
class Modal {
    constructor(type) {
        this.type = type;
        this.modal = null;
        this.create();
        this.initializeEventListeners();
    }

    create() {
        this.modal = document.createElement('div');
        this.modal.className = 'modal';
        this.modal.id = `${this.type}-modal`;
        
        this.modal.innerHTML = this.getModalContent();
        document.body.appendChild(this.modal);
        
        this.initializeGoogleButton();
    }

    getModalContent() {
        const emailValidator = new EmailValidator();
        
        const modalContent = `
            <div class="modal-content">
                <span class="close-modal">&times;</span>
                <h2>${this.type === 'login' ? 'Login' : 'Registo'}</h2>
                
                <div class="google-signin-button"></div>
                
                <div class="divider">
                    <span>ou</span>
                </div>
                
                <form class="auth-form" id="${this.type}-form">
                    ${this.type === 'registro' ? `
                        <div class="form-group">
                            <label for="nome">Nome Completo</label>
                            <input type="text" id="nome" name="nome" required>
                        </div>
                    ` : ''}
                    <div class="form-group">
                        <label for="email">Email</label>
                        <div class="input-with-feedback">
                            <input type="email" id="email" name="email" required 
                                   placeholder="exemplo@epfundao.pt"
                                   autocomplete="email">
                            <div class="email-feedback"></div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="senha">Senha</label>
                        <div class="password-input">
                            <input type="password" id="senha" name="senha" required>
                            <button type="button" class="toggle-password" aria-label="Mostrar senha">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                    </div>
                    ${this.type === 'registro' ? `
                        <div class="form-group">
                            <label for="confirmar-senha">Confirmar Senha</label>
                            <div class="password-input">
                                <input type="password" id="confirmar-senha" name="confirmar-senha" required>
                                <button type="button" class="toggle-password" aria-label="Mostrar senha">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </div>
                        </div>
                    ` : ''}
                    <button type="submit" class="submit-btn" disabled>
                        ${this.type === 'login' ? 'Entrar' : 'Registar'}
                    </button>
                </form>
            </div>
        `;
        
        return modalContent;
    }

    initializeEventListeners() {
        this.modal.querySelector('.close-modal').onclick = () => this.close();
        this.modal.onclick = (e) => {
            if (e.target === this.modal) this.close();
        };
        
        this.initializeFormValidation();
    }

    close() {
        this.modal.remove();
        stateManager.setState({ activeModal: null });
    }

    initializeGoogleButton() {
        google.accounts.id.renderButton(
            this.modal.querySelector('.google-signin-button'),
            { 
                type: 'standard',
                theme: 'outline',
                size: 'large',
                width: '100%',
                text: 'signin_with',
                shape: 'rectangular',
                logo_alignment: 'left'
            }
        );
    }

    initializeFormValidation() {
        const form = this.modal.querySelector('form');
        const emailInput = form.querySelector('#email');
        const submitBtn = form.querySelector('.submit-btn');
        
        if (emailInput) {
            emailInput.addEventListener('input', Utils.debounce(async (e) => {
                const email = e.target.value;
                await this.validateEmail(email, submitBtn);
            }, 300));
        }

        form.onsubmit = async (e) => {
            e.preventDefault();
            await this.handleSubmit(form);
        };
    }

    async validateEmail(email, submitBtn) {
        if (!Utils.validateEmail(email)) {
            NotificationManager.show('Por favor, insira um email válido.', 'error');
            submitBtn.disabled = true;
            return;
        }

        if (!this.emailValidator.isValidDomain(email)) {
            NotificationManager.show('Este email não é permitido. Por favor, use um email da lista.', 'error');
            submitBtn.disabled = true;
            return;
        }

        submitBtn.disabled = false;
    }

    async handleSubmit(form) {
        const data = new FormData(form);
        const email = data.get('email');
        const senha = data.get('senha');

        try {
            const response = await Utils.fetchWithTimeout(CONFIG.API_ENDPOINTS.AUTH + '/' + this.type, {
                method: 'POST',
                body: JSON.stringify({ email, senha })
            });
            
            if (response.ok) {
                NotificationManager.show('Autenticação bem-sucedida!', 'success');
                this.close();
            } else {
                throw new Error('Erro ao processar a autenticação');
            }
        } catch (error) {
            console.error('Erro ao processar a autenticação:', error);
            NotificationManager.show('Erro ao processar a autenticação. Tente novamente mais tarde.', 'error');
        }
    }
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    // Inicializar gerenciadores
    const stateManager = new StateManager();
    const authManager = new AuthManager(stateManager);
    
    // Configurar eventos globais
    setupScrollEvents();
    setupNavigationEvents();
    setupNewsletterForm();
    
    // Verificar estado de autenticação
    const userData = JSON.parse(localStorage.getItem('userData'));
    if (userData) {
        authManager.setAuthState(userData, localStorage.getItem('authToken'));
    }
});

// Eventos de Scroll
function setupScrollEvents() {
    const header = document.querySelector('.header');
    let lastScroll = 0;

    window.addEventListener('scroll', Utils.debounce(() => {
        const currentScroll = window.pageYOffset;
        
        if (currentScroll <= 0) {
            header.classList.remove('scroll-up');
            return;
        }
        
        if (currentScroll > lastScroll && !header.classList.contains('scroll-down')) {
            header.classList.remove('scroll-up');
            header.classList.add('scroll-down');
        } else if (currentScroll < lastScroll && header.classList.contains('scroll-down')) {
            header.classList.remove('scroll-down');
            header.classList.add('scroll-up');
        }
        lastScroll = currentScroll;
    }, 100));
}

// Eventos de Navegação
function setupNavigationEvents() {
    // Smooth Scroll
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Menu Mobile
    const menuButton = document.createElement('button');
    menuButton.className = 'menu-toggle';
    menuButton.innerHTML = '<i class="fas fa-bars"></i>';
    document.querySelector('.nav-container').prepend(menuButton);

    menuButton.addEventListener('click', () => {
        const navMenu = document.querySelector('.nav-menu');
        navMenu.classList.toggle('active');
        menuButton.classList.toggle('active');
    });
}

// Newsletter
function setupNewsletterForm() {
    const newsletterForm = document.querySelector('.newsletter-form');
    if (newsletterForm) {
        newsletterForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = newsletterForm.querySelector('input[type="email"]').value;
            
            if (!Utils.validateEmail(email)) {
                NotificationManager.show('Por favor, insira um email válido.', 'error');
                return;
            }
            
            try {
                const response = await Utils.fetchWithTimeout(CONFIG.API_ENDPOINTS.NEWSLETTER, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    NotificationManager.show('Obrigado por se inscrever!', 'success');
                    newsletterForm.reset();
                } else {
                    throw new Error(data.message);
                }
            } catch (error) {
                console.error('Erro ao inscrever na newsletter:', error);
                NotificationManager.show('Erro ao processar sua inscrição. Tente novamente.', 'error');
            }
        });
    }
}

// Compartilhamento Social
function shareContent(platform) {
    const url = encodeURIComponent(window.location.href);
    const title = encodeURIComponent(document.title);
    const shareUrls = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
        twitter: `https://twitter.com/intent/tweet?url=${url}&text=${title}`,
        linkedin: `https://www.linkedin.com/shareArticle?mini=true&url=${url}&title=${title}`
    };

    const shareUrl = shareUrls[platform];
    if (shareUrl) {
        window.open(shareUrl, '_blank', 'width=600,height=400');
    }
}

// Exportar para uso global
window.authManager = authManager;
window.shareContent = shareContent; 