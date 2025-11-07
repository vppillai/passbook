// Passbook Web Dashboard - Complete Application
// API Configuration
const API_URL = 'https://afbtrc48hc.execute-api.us-west-2.amazonaws.com/development';

// Application State
const state = {
    currentPage: 'login',
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
    if (token && user) {
        state.token = token;
        state.user = JSON.parse(user);
    }
}

function saveStateToStorage() {
    if (state.token) {
        localStorage.setItem('authToken', state.token);
        localStorage.setItem('user', JSON.stringify(state.user));
    } else {
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
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
            throw new Error(data.error || 'Request failed');
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
            ${renderSidebar()}
            <div class="main-content">
                ${renderCurrentPage()}
            </div>
        `;
        attachGlobalHandlers();
    }
}

// Render Sidebar
function renderSidebar() {
    return `
        <div class="sidebar">
            <div class="sidebar-header">
                <h2>🏦 Passbook</h2>
                <p>${state.user?.displayName || 'User'}</p>
                <p style="font-size: 12px; opacity: 0.7;">${state.user?.email || ''}</p>
            </div>
            <ul class="nav-menu">
                <li class="nav-item">
                    <a href="#" class="nav-link ${state.currentPage === 'dashboard' ? 'active' : ''}" onclick="navigate('dashboard')">
                        <span class="nav-icon">📊</span>
                        Dashboard
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link ${state.currentPage === 'family' ? 'active' : ''}" onclick="navigate('family')">
                        <span class="nav-icon">👨‍👩‍👧‍👦</span>
                        Family
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link ${state.currentPage === 'children' ? 'active' : ''}" onclick="navigate('children')">
                        <span class="nav-icon">👶</span>
                        Children
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link ${state.currentPage === 'expenses' ? 'active' : ''}" onclick="navigate('expenses')">
                        <span class="nav-icon">💳</span>
                        Expenses
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link ${state.currentPage === 'funds' ? 'active' : ''}" onclick="navigate('funds')">
                        <span class="nav-icon">💰</span>
                        Add Funds
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link ${state.currentPage === 'analytics' ? 'active' : ''}" onclick="navigate('analytics')">
                        <span class="nav-icon">📈</span>
                        Analytics
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link" onclick="logout()">
                        <span class="nav-icon">🚪</span>
                        Logout
                    </a>
                </li>
            </ul>
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
                <div class="logo">🏦</div>
                <h1>Passbook</h1>
                <p class="subtitle">Family Allowance Manager</p>
                
                <div id="loginMessage"></div>
                
                <form id="loginForm">
                    <div class="form-group">
                        <label>Email</label>
                        <input type="email" id="email" required value="support@embeddedinn.com">
                    </div>
                    <div class="form-group">
                        <label>Password</label>
                        <input type="password" id="password" required value="Passbook2025!">
                    </div>
                    <button type="submit" class="btn btn-primary btn-block">Login</button>
                </form>
                
                <div style="margin-top: 24px; padding: 16px; background: #f7fafc; border-radius: 8px;">
                    <p style="font-size: 14px; color: #4a5568;"><strong>Test Account:</strong></p>
                    <p style="font-size: 13px; color: #718096;">Email: support@embeddedinn.com</p>
                    <p style="font-size: 13px; color: #718096;">Password: Passbook2025!</p>
                </div>
            </div>
        </div>
    `;
}

function attachLoginHandlers() {
    const form = document.getElementById('loginForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const messageDiv = document.getElementById('loginMessage');
        
        messageDiv.innerHTML = '<div class="alert alert-info">Logging in...</div>';
        
        try {
            const data = await apiCall('/auth/login', 'POST', { email, password });
            
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
    return `
        <h1 style="margin-bottom: 24px;">Dashboard</h1>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">👨‍👩‍👧‍👦</div>
                <div class="stat-label">Family Status</div>
                <div class="stat-value">${state.user?.familyId !== 'UNASSIGNED' ? 'Active' : 'Not Set'}</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">👶</div>
                <div class="stat-label">Children</div>
                <div class="stat-value">${state.children.length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">💳</div>
                <div class="stat-label">Total Expenses</div>
                <div class="stat-value">${state.expenses.length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">💰</div>
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
                <button class="btn btn-primary" onclick="navigate('children')">➕ Add Child</button>
                <button class="btn btn-success" onclick="navigate('funds')">💰 Add Funds</button>
                <button class="btn btn-secondary" onclick="navigate('expenses')">📝 Log Expense</button>
                <button class="btn btn-secondary" onclick="navigate('analytics')">📊 View Analytics</button>
            </div>
        </div>
    `;
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
                            <option value="USD">USD - US Dollar</option>
                            <option value="EUR">EUR - Euro</option>
                            <option value="GBP">GBP - British Pound</option>
                            <option value="INR">INR - Indian Rupee</option>
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
                <button class="btn btn-primary" onclick="showAddChildModal()">➕ Add Child</button>
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
                        <label>Age</label>
                        <input type="number" id="childAge" required min="1" max="25">
                    </div>
                    <div class="form-group">
                        <label>Weekly Allowance</label>
                        <input type="number" id="allowance" required step="0.01" min="0">
                    </div>
                    <button type="submit" class="btn btn-primary btn-block">Add Child</button>
                </form>
            </div>
        </div>
    `;
}

// Expenses Page
function renderExpenses() {
    return `
        <h1 style="margin-bottom: 24px;">Expense Tracking</h1>
        
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">Recent Expenses</h2>
                <button class="btn btn-primary" onclick="showAddExpenseModal()">➕ Add Expense</button>
            </div>
            <div id="expensesList">
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Loading expenses...</p>
                </div>
            </div>
        </div>
        
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
                            <option value="food">🍔 Food</option>
                            <option value="entertainment">🎮 Entertainment</option>
                            <option value="education">📚 Education</option>
                            <option value="clothing">👕 Clothing</option>
                            <option value="other">📦 Other</option>
                        </select>
                    </div>
                    <button type="submit" class="btn btn-primary btn-block">Add Expense</button>
                </form>
            </div>
        </div>
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
            const age = document.getElementById('childAge').value;
            const weeklyAllowance = document.getElementById('allowance').value;
            const messageDiv = document.getElementById('childMessage');
            
            messageDiv.innerHTML = '<div class="alert alert-info">Adding child...</div>';
            
            try {
                await apiCall('/children', 'POST', { 
                    displayName, 
                    age: parseInt(age),
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
                            <th>Age</th>
                            <th>Allowance</th>
                            <th>Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.children.map(child => `
                            <tr>
                                <td><strong>${child.displayName}</strong></td>
                                <td>${child.age}</td>
                                <td>$${child.weeklyAllowance?.toFixed(2) || '0.00'}/week</td>
                                <td>$${child.balance?.toFixed(2) || '0.00'}</td>
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
        const data = await apiCall('/expenses');
        state.expenses = data.expenses || [];
        
        const listDiv = document.getElementById('expensesList');
        if (state.expenses.length === 0) {
            listDiv.innerHTML = '<p style="padding: 20px; text-align: center; color: #a0aec0;">No expenses logged yet. Click "Add Expense" to get started.</p>';
        } else {
            listDiv.innerHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Child</th>
                            <th>Description</th>
                            <th>Category</th>
                            <th>Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.expenses.map(expense => `
                            <tr>
                                <td>${new Date(expense.date).toLocaleDateString()}</td>
                                <td>${expense.childName || 'Unknown'}</td>
                                <td>${expense.description}</td>
                                <td><span class="badge badge-${expense.status || 'success'}">${expense.category}</span></td>
                                <td><strong>$${expense.amount?.toFixed(2) || '0.00'}</strong></td>
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

