// Passbook Web Dashboard - Complete Application
// API Configuration
const API_URL = 'https://afbtrc48hc.execute-api.us-west-2.amazonaws.com/development';
const VERSION = 'v1.0.0-1-g0d5da08'; // Will be replaced during deployment

// Currency symbols
const currencySymbols = {
    USD: '$',
    CAD: '$',
    EUR: '€',
    GBP: '£',
    INR: '₹'
};

function formatCurrency(amount, currency = 'CAD') {
    const symbol = currencySymbols[currency] || currency;
    return `${symbol}${parseFloat(amount || 0).toFixed(2)}`;
}

// SVG Icons
const icons = {
    dashboard: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3v6h8V3m-8 18h8V11h-8M3 21h8v-6H3m0-2h8V3H3v10z"/></svg>',
    family: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16 4c0-1.11.89-2 2-2s2 .89 2 2-.89 2-2 2-2-.89-2-2m4 18v-6h2.5l-2.54-7.63C19.68 7.55 18.92 7 18.06 7h-.12c-.86 0-1.62.55-1.9 1.37L13.5 16H16v6h4M6 6c1.11 0 2-.89 2-2s-.89-2-2-2-2 .89-2 2 .89 2 2 2m1 16v-7H9.5l-1.75-5.26c-.28-.82-1.04-1.37-1.9-1.37h-.2c-.86 0-1.62.55-1.9 1.37L2 15h2.5v7h2.5z"/></svg>',
    children: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>',
    expenses: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>',
    funds: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>',
    analytics: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>',
    logout: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>',
    bank: '<svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M4 10v7h3v-7H4M10 10v7h3v-7h-3M2 22h19v-3H2v3M17 10v7h3v-7h-3M12 3L2 8v2h19V8l-10-5z"/></svg>',
    add: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
    edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
    delete: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    user: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
    menu: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>'
};

// Application State
const state = {
    currentPage: 'login',
    userType: 'parent', // 'parent' or 'child'
    user: null,
    token: null,
    family: null,
    children: [],
    expenses: [],
    loading: false
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    loadStateFromStorage();
    if (state.token) {
        state.currentPage = 'dashboard';
    }
    render();
});

// Storage Functions
function loadStateFromStorage() {
    const token = localStorage.getItem('authToken');
    const user = localStorage.getItem('user');
    const userType = localStorage.getItem('userType');
    if (token && user) {
        state.token = token;
        state.user = JSON.parse(user);
        state.userType = userType || 'parent';
    }
}

function saveStateToStorage() {
    if (state.token) {
        localStorage.setItem('authToken', state.token);
        localStorage.setItem('user', JSON.stringify(state.user));
        localStorage.setItem('userType', state.userType);
    } else {
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
        localStorage.removeItem('userType');
    }
}

// API Helper
async function apiCall(endpoint, method = 'GET', body = null) {
    const headers = {
        'Content-Type': 'application/json',
    };

    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }

    const options = {
        method,
        headers,
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${API_URL}${endpoint}`, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Request failed: ${response.status}`);
        }

        return data;
    } catch (error) {
        throw error;
    }
}

// Navigation
function navigate(page) {
    state.currentPage = page;
    render();
}

function logout() {
    state.user = null;
    state.token = null;
    state.family = null;
    state.children = [];
    state.expenses = [];
    state.userType = 'parent';
    saveStateToStorage();
    navigate('login');
}

// Render Main App
function render() {
    const app = document.getElementById('app');

    if (state.currentPage === 'login') {
        app.innerHTML = renderLoginPage();
        attachLoginHandlers();
    } else {
        app.innerHTML = `
            <button class="mobile-menu-btn" onclick="toggleMobileMenu()" aria-label="Toggle menu">
                ${icons.menu}
            </button>
            <div class="mobile-overlay" onclick="closeMobileMenu()"></div>
            ${renderSidebar()}
            <div class="main-content">
                ${renderCurrentPage()}
            </div>
        `;
        attachGlobalHandlers();
    }
}

// Mobile Menu Functions
function toggleMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.mobile-overlay');
    sidebar.classList.toggle('mobile-open');
    overlay.classList.toggle('active');
}

function closeMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.mobile-overlay');
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('active');
}

function navigateAndCloseMobile(page) {
    closeMobileMenu();
    navigate(page);
}

function logoutAndCloseMobile() {
    closeMobileMenu();
    logout();
}

// Render Sidebar
function renderSidebar() {
    const isParent = state.userType === 'parent';

    return `
        <div class="sidebar">
            <div class="sidebar-header">
                <h2>${icons.bank} Passbook</h2>
                <p><span style="display: inline-flex; align-items: center;">${icons.user}</span> ${state.user?.displayName || 'User'}</p>
                <p style="font-size: 12px; opacity: 0.7;">${state.user?.email || state.user?.username || ''}</p>
                <p style="font-size: 11px; opacity: 0.6; margin-top: 4px;">${isParent ? 'Parent Account' : 'Child Account'}</p>
            </div>
            <ul class="nav-menu">
                <li class="nav-item">
                    <a href="#" class="nav-link ${state.currentPage === 'dashboard' ? 'active' : ''}" onclick="navigateAndCloseMobile('dashboard'); return false;">
                        <span class="nav-icon">${icons.dashboard}</span>
                        Dashboard
                    </a>
                </li>
                ${isParent ? `
                <li class="nav-item">
                    <a href="#" class="nav-link ${state.currentPage === 'family' ? 'active' : ''}" onclick="navigateAndCloseMobile('family'); return false;">
                        <span class="nav-icon">${icons.family}</span>
                        Family
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link ${state.currentPage === 'children' ? 'active' : ''}" onclick="navigateAndCloseMobile('children'); return false;">
                        <span class="nav-icon">${icons.children}</span>
                        Children
                    </a>
                </li>
                ` : ''}
                <li class="nav-item">
                    <a href="#" class="nav-link ${state.currentPage === 'expenses' ? 'active' : ''}" onclick="navigateAndCloseMobile('expenses'); return false;">
                        <span class="nav-icon">${icons.expenses}</span>
                        ${isParent ? 'Expenses' : 'My Expenses'}
                    </a>
                </li>
                ${isParent ? `
                <li class="nav-item">
                    <a href="#" class="nav-link ${state.currentPage === 'funds' ? 'active' : ''}" onclick="navigateAndCloseMobile('funds'); return false;">
                        <span class="nav-icon">${icons.funds}</span>
                        Add Funds
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link ${state.currentPage === 'analytics' ? 'active' : ''}" onclick="navigateAndCloseMobile('analytics'); return false;">
                        <span class="nav-icon">${icons.analytics}</span>
                        Analytics
                    </a>
                </li>
                ` : ''}
                <li class="nav-item">
                    <a href="#" class="nav-link" onclick="logoutAndCloseMobile(); return false;">
                        <span class="nav-icon">${icons.logout}</span>
                        Logout
                    </a>
                </li>
            </ul>
            <div style="padding: 20px; text-align: center; font-size: 11px; opacity: 0.5; border-top: 1px solid rgba(255,255,255,0.1); margin-top: auto;">
                v${VERSION}
            </div>
        </div>
    `;
}

// Render Current Page
function renderCurrentPage() {
    switch (state.currentPage) {
        case 'dashboard':
            return renderDashboard();
        case 'family':
            return renderFamily();
        case 'children':
            return renderChildren();
        case 'expenses':
            return renderExpenses();
        case 'funds':
            return renderFunds();
        case 'analytics':
            return renderAnalytics();
        default:
            return renderDashboard();
    }
}

// Login Page
function renderLoginPage() {
    return `
        <div class="login-container">
            <div class="login-box">
                <div class="logo">${icons.bank}</div>
                <h1>Passbook</h1>
                <p class="subtitle">Family Allowance Manager</p>

                <div style="display: flex; gap: 8px; margin-bottom: 24px;">
                    <button
                        id="parentLoginTab"
                        class="btn ${state.userType === 'parent' ? 'btn-primary' : 'btn-secondary'}"
                        style="flex: 1;"
                        onclick="switchLoginType('parent')"
                    >
                        Parent Login
                    </button>
                    <button
                        id="childLoginTab"
                        class="btn ${state.userType === 'child' ? 'btn-primary' : 'btn-secondary'}"
                        style="flex: 1;"
                        onclick="switchLoginType('child')"
                    >
                        Child Login
                    </button>
                </div>

                <div id="loginMessage"></div>

                <form id="loginForm">
                    <div class="form-group">
                        <label>${state.userType === 'parent' ? 'Email' : 'Username or Email'}</label>
                        <input type="${state.userType === 'parent' ? 'email' : 'text'}" id="loginIdentifier" required>
                    </div>
                    <div class="form-group">
                        <label>Password</label>
                        <input type="password" id="password" required>
                    </div>
                    <button type="submit" class="btn btn-primary btn-block">Login</button>
                </form>
            </div>
        </div>
    `;
}

function switchLoginType(type) {
    state.userType = type;
    render();
}

function attachLoginHandlers() {
    const form = document.getElementById('loginForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const identifier = document.getElementById('loginIdentifier').value;
        const password = document.getElementById('password').value;
        const messageDiv = document.getElementById('loginMessage');

        messageDiv.innerHTML = '<div class="alert alert-info">Logging in...</div>';

        try {
            const loginData = state.userType === 'parent'
                ? { email: identifier, password }
                : { username: identifier, password };

            const data = await apiCall('/auth/login', 'POST', loginData);

            state.user = data.user;
            state.token = data.token;
            saveStateToStorage();

            messageDiv.innerHTML = '<div class="alert alert-success">Login successful!</div>';
            setTimeout(() => navigate('dashboard'), 500);
        } catch (error) {
            messageDiv.innerHTML = `<div class="alert alert-error">${error.message}</div>`;
        }
    });
}

// Dashboard Page
function renderDashboard() {
    const isParent = state.userType === 'parent';

    if (isParent) {
        return `
            <h1 style="margin-bottom: 24px;">Dashboard</h1>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon">${icons.family}</div>
                    <div class="stat-label">Family Status</div>
                    <div class="stat-value">${state.user?.familyId !== 'UNASSIGNED' ? 'Active' : 'Not Set'}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">${icons.children}</div>
                    <div class="stat-label">Children</div>
                    <div class="stat-value">${state.children.length}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">${icons.expenses}</div>
                    <div class="stat-label">Total Expenses</div>
                    <div class="stat-value">${state.expenses.length}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">${icons.funds}</div>
                    <div class="stat-label">Total Balance</div>
                    <div class="stat-value">$0.00</div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Welcome to Passbook!</h2>
                </div>
                <div class="card-body">
                    ${state.user?.familyId === 'UNASSIGNED' ? `
                        <div class="alert alert-info">
                            <strong>Get Started:</strong> Create a family to begin managing allowances and expenses.
                        </div>
                        <button class="btn btn-primary" onclick="navigate('family')">Create Family</button>
                    ` : `
                        <p>Your family allowance management system is active.</p>
                        <div style="margin-top: 16px;">
                            <button class="btn btn-primary" onclick="navigate('children')">Manage Children</button>
                            <button class="btn btn-success" onclick="navigate('expenses')" style="margin-left: 8px;">Track Expenses</button>
                        </div>
                    `}
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Quick Actions</h2>
                </div>
                <div class="card-body" style="display: flex; gap: 16px; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="navigate('children')">${icons.add} Add Child</button>
                    <button class="btn btn-success" onclick="navigate('funds')">${icons.funds} Add Funds</button>
                    <button class="btn btn-secondary" onclick="navigate('expenses')">${icons.expenses} Log Expense</button>
                    <button class="btn btn-secondary" onclick="navigate('analytics')">${icons.analytics} View Analytics</button>
                </div>
            </div>
        `;
    } else {
        return `
            <h1 style="margin-bottom: 24px;">My Dashboard</h1>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon">${icons.funds}</div>
                    <div class="stat-label">Current Balance</div>
                    <div class="stat-value">$${state.user?.currentBalance || '0.00'}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">${icons.expenses}</div>
                    <div class="stat-label">Total Expenses</div>
                    <div class="stat-value">${state.expenses.length}</div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Welcome ${state.user?.displayName}!</h2>
                </div>
                <div class="card-body">
                    <p>Track your expenses and manage your allowance.</p>
                    <div style="margin-top: 16px;">
                        <button class="btn btn-primary" onclick="navigate('expenses')">View My Expenses</button>
                    </div>
                </div>
            </div>
        `;
    }
}

// Family Page
function renderFamily() {
    return `
        <h1 style="margin-bottom: 24px;">Family Management</h1>

        ${state.user?.familyId === 'UNASSIGNED' ? `
            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Create Your Family</h2>
                </div>
                <div id="familyMessage"></div>
                <form id="createFamilyForm">
                    <div class="form-group">
                        <label>Family Name</label>
                        <input type="text" id="familyName" required placeholder="e.g., The Smith Family">
                    </div>
                    <div class="form-group">
                        <label>Currency</label>
                        <select id="currency" required>
                            <option value="CAD" selected>CAD - Canadian Dollar ($)</option>
                            <option value="USD">USD - US Dollar ($)</option>
                            <option value="EUR">EUR - Euro (€)</option>
                            <option value="GBP">GBP - British Pound (£)</option>
                            <option value="INR">INR - Indian Rupee (₹)</option>
                        </select>
                    </div>
                    <button type="submit" class="btn btn-primary">Create Family</button>
                </form>
            </div>
        ` : `
            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Family Information</h2>
                </div>
                <div class="alert alert-success">
                    <strong>Family ID:</strong> ${state.user.familyId}
                </div>
                <p>Your family is active and ready to manage allowances!</p>
                <div style="margin-top: 16px;">
                    <button class="btn btn-primary" onclick="navigate('children')">Manage Children</button>
                </div>
            </div>
        `}
    `;
}

// Children Page
function renderChildren() {
    return `
        <h1 style="margin-bottom: 24px;">Child Management</h1>

        <div class="card">
            <div class="card-header">
                <h2 class="card-title">Children</h2>
                <button class="btn btn-primary" onclick="showAddChildModal()">${icons.add} Add Child</button>
            </div>
            <div id="childrenList">
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Loading children...</p>
                </div>
            </div>
        </div>

        <div id="addChildModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">Add Child</h2>
                    <button class="close-btn" onclick="closeModal('addChildModal')">×</button>
                </div>
                <div id="childMessage"></div>
                <form id="addChildForm">
                    <div class="form-group">
                        <label>Display Name</label>
                        <input type="text" id="childName" required>
                    </div>
                    <div class="form-group">
                        <label>Username</label>
                        <input type="text" id="childUsername" required>
                    </div>
                    <div class="form-group">
                        <label>Password</label>
                        <input type="password" id="childPassword" required minlength="6">
                    </div>
                    <div class="form-group">
                        <label>Allowance Amount</label>
                        <input type="number" id="allowance" required step="0.01" min="0" placeholder="10.00">
                    </div>
                    <div class="form-group">
                        <label>Allowance Frequency</label>
                        <select id="fundingPeriodType" required>
                            <option value="weekly">Weekly</option>
                            <option value="biweekly">Bi-weekly</option>
                            <option value="monthly">Monthly</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Start Date (optional)</label>
                        <input type="date" id="fundingStartDate">
                    </div>
                    <button type="submit" class="btn btn-primary btn-block">Add Child</button>
                </form>
            </div>
        </div>
    `;
}

// Expenses Page
function renderExpenses() {
    const isParent = state.userType === 'parent';

    return `
        <h1 style="margin-bottom: 24px;">${isParent ? 'Expense Tracking' : 'My Expenses'}</h1>

        <div class="card">
            <div class="card-header">
                <h2 class="card-title">Recent Expenses</h2>
                ${isParent ? `<button class="btn btn-primary" onclick="showAddExpenseModal()">${icons.add} Add Expense</button>` : ''}
            </div>
            <div id="expensesList">
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Loading expenses...</p>
                </div>
            </div>
        </div>

        ${isParent ? `
        <div id="addExpenseModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">Add Expense</h2>
                    <button class="close-btn" onclick="closeModal('addExpenseModal')">×</button>
                </div>
                <div id="expenseMessage"></div>
                <form id="addExpenseForm">
                    <div class="form-group">
                        <label>Child</label>
                        <select id="childId" required>
                            <option value="">Select Child</option>
                            ${state.children.map(child =>
        `<option value="${child.userId}">${child.displayName}</option>`
    ).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Description</label>
                        <input type="text" id="description" required>
                    </div>
                    <div class="form-group">
                        <label>Amount</label>
                        <input type="number" id="amount" required step="0.01" min="0.01">
                    </div>
                    <div class="form-group">
                        <label>Category</label>
                        <select id="category" required>
                            <option value="food">Food</option>
                            <option value="entertainment">Entertainment</option>
                            <option value="education">Education</option>
                            <option value="clothing">Clothing</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                    <button type="submit" class="btn btn-primary btn-block">Add Expense</button>
                </form>
            </div>
        </div>
        ` : ''}
    `;
}

// Funds Page
function renderFunds() {
    return `
        <h1 style="margin-bottom: 24px;">Add Funds</h1>

        <div class="card">
            <div class="card-header">
                <h2 class="card-title">Add Funds to Child Account</h2>
            </div>
            <div id="fundsMessage"></div>
            <form id="addFundsForm">
                <div class="form-group">
                    <label>Select Child</label>
                    <select id="fundChildId" required>
                        <option value="">Select Child</option>
                        ${state.children.map(child =>
        `<option value="${child.userId}">${child.displayName}</option>`
    ).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Amount</label>
                    <input type="number" id="fundAmount" required step="0.01" min="0.01">
                </div>
                <div class="form-group">
                    <label>Notes (optional)</label>
                    <textarea id="fundNotes" rows="3"></textarea>
                </div>
                <button type="submit" class="btn btn-success btn-block">Add Funds</button>
            </form>
        </div>
    `;
}

// Analytics Page
function renderAnalytics() {
    return `
        <h1 style="margin-bottom: 24px;">Analytics & Reports</h1>

        <div class="card">
            <div class="card-header">
                <h2 class="card-title">Spending Overview</h2>
            </div>
            <p>Analytics features coming soon!</p>
            <p>This will include:</p>
            <ul style="margin-top: 16px; margin-left: 24px;">
                <li>Spending trends by category</li>
                <li>Child spending comparison</li>
                <li>Monthly expense reports</li>
                <li>Budget tracking</li>
                <li>Export to PDF/Excel</li>
            </ul>
        </div>

        <div class="card">
            <div class="card-header">
                <h2 class="card-title">Quick Stats</h2>
            </div>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Total Children</div>
                    <div class="stat-value">${state.children.length}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Total Expenses</div>
                    <div class="stat-value">${state.expenses.length}</div>
                </div>
            </div>
        </div>
    `;
}

// Modal Functions
function showAddChildModal() {
    document.getElementById('addChildModal').classList.add('active');
}

function showAddExpenseModal() {
    document.getElementById('addExpenseModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Global Event Handlers
function attachGlobalHandlers() {
    // Create Family Form
    const createFamilyForm = document.getElementById('createFamilyForm');
    if (createFamilyForm) {
        createFamilyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const familyName = document.getElementById('familyName').value;
            const currency = document.getElementById('currency').value;
            const messageDiv = document.getElementById('familyMessage');

            messageDiv.innerHTML = '<div class="alert alert-info">Creating family...</div>';

            try {
                await apiCall('/families', 'POST', { familyName, currency });
                messageDiv.innerHTML = '<div class="alert alert-success">Family created successfully!</div>';

                // Reload user data
                setTimeout(() => {
                    state.user.familyId = 'created';
                    saveStateToStorage();
                    render();
                }, 1000);
            } catch (error) {
                messageDiv.innerHTML = `<div class="alert alert-error">${error.message}</div>`;
            }
        });
    }

    // Add Child Form
    const addChildForm = document.getElementById('addChildForm');
    if (addChildForm) {
        addChildForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const displayName = document.getElementById('childName').value;
            const username = document.getElementById('childUsername').value;
            const password = document.getElementById('childPassword').value;
            const weeklyAllowance = document.getElementById('allowance').value;
            const messageDiv = document.getElementById('childMessage');

            messageDiv.innerHTML = '<div class="alert alert-info">Adding child...</div>';

            try {
                await apiCall('/children', 'POST', {
                    displayName,
                    username,
                    password,
                    weeklyAllowance: parseFloat(weeklyAllowance)
                });
                messageDiv.innerHTML = '<div class="alert alert-success">Child added successfully!</div>';
                closeModal('addChildModal');
                loadChildren();
            } catch (error) {
                messageDiv.innerHTML = `<div class="alert alert-error">${error.message}</div>`;
            }
        });

        loadChildren();
    }

    // Add Expense Form
    const addExpenseForm = document.getElementById('addExpenseForm');
    if (addExpenseForm) {
        addExpenseForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const childId = document.getElementById('childId').value;
            const description = document.getElementById('description').value;
            const amount = document.getElementById('amount').value;
            const category = document.getElementById('category').value;
            const messageDiv = document.getElementById('expenseMessage');

            messageDiv.innerHTML = '<div class="alert alert-info">Adding expense...</div>';

            try {
                await apiCall('/expenses', 'POST', {
                    childId,
                    description,
                    amount: parseFloat(amount),
                    category
                });
                messageDiv.innerHTML = '<div class="alert alert-success">Expense added successfully!</div>';
                closeModal('addExpenseModal');
                loadExpenses();
            } catch (error) {
                messageDiv.innerHTML = `<div class="alert alert-error">${error.message}</div>`;
            }
        });

        loadExpenses();
    }

    // Add Funds Form
    const addFundsForm = document.getElementById('addFundsForm');
    if (addFundsForm) {
        addFundsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const childId = document.getElementById('fundChildId').value;
            const amount = document.getElementById('fundAmount').value;
            const notes = document.getElementById('fundNotes').value;
            const messageDiv = document.getElementById('fundsMessage');

            messageDiv.innerHTML = '<div class="alert alert-info">Adding funds...</div>';

            try {
                await apiCall('/funds', 'POST', {
                    childId,
                    amount: parseFloat(amount),
                    notes
                });
                messageDiv.innerHTML = '<div class="alert alert-success">Funds added successfully!</div>';
                addFundsForm.reset();
            } catch (error) {
                messageDiv.innerHTML = `<div class="alert alert-error">${error.message}</div>`;
            }
        });
    }
}

// Load Data Functions
async function loadChildren() {
    try {
        const data = await apiCall('/children');
        state.children = data.children || [];

        const listDiv = document.getElementById('childrenList');
        if (state.children.length === 0) {
            listDiv.innerHTML = '<p style="padding: 20px; text-align: center; color: #a0aec0;">No children added yet. Click "Add Child" to get started.</p>';
        } else {
            listDiv.innerHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Username</th>
                            <th>Weekly Allowance</th>
                            <th>Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.children.map(child => `
                            <tr>
                                <td><strong>${child.displayName}</strong></td>
                                <td>${child.username || 'N/A'}</td>
                                <td>${formatCurrency(child.weeklyAllowance, state.family?.currency)}/week</td>
                                <td>${formatCurrency(child.currentBalance, state.family?.currency)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    } catch (error) {
        document.getElementById('childrenList').innerHTML =
            `<div class="alert alert-error">Failed to load children: ${error.message}</div>`;
    }
}

async function loadExpenses() {
    try {
        const endpoint = state.userType === 'child' ? `/expenses?childUserId=${state.user.userId}` : '/expenses';
        const data = await apiCall(endpoint);
        state.expenses = data.expenses || [];

        const listDiv = document.getElementById('expensesList');
        if (state.expenses.length === 0) {
            listDiv.innerHTML = '<p style="padding: 20px; text-align: center; color: #a0aec0;">No expenses logged yet.</p>';
        } else {
            listDiv.innerHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            ${state.userType === 'parent' ? '<th>Child</th>' : ''}
                            <th>Description</th>
                            <th>Category</th>
                            <th>Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.expenses.map(expense => `
                            <tr>
                                <td>${new Date(expense.date || expense.expenseDate).toLocaleDateString()}</td>
                                ${state.userType === 'parent' ? `<td>${expense.childName || 'Unknown'}</td>` : ''}
                                <td>${expense.description}</td>
                                <td><span class="badge badge-${expense.status || 'success'}">${expense.category}</span></td>
                                <td><strong>${formatCurrency(expense.amount, state.family?.currency)}</strong></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    } catch (error) {
        document.getElementById('expensesList').innerHTML =
            `<div class="alert alert-error">Failed to load expenses: ${error.message}</div>`;
    }
}
