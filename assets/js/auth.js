// Authentication system using server API
let isRegisterMode = false;
// Prefer same-origin. When using Live Server on 5500, also try local API servers.
const isLiveServer = (location.port === '5500') && (location.protocol.startsWith('http'));
const API_BASE_CANDIDATES = ['']
  .concat(isLiveServer ? ['http://127.0.0.1:4242', 'http://localhost:4242'] : []);

async function fetchWithFallback(path, options) {
  let lastErr;
  for (const base of API_BASE_CANDIDATES) {
    try {
      const res = await fetch(`${base}${path}`, options);
      // Treat non-2xx as failure to allow trying next base
      if (res.ok) return res;
      // If this is the last base, return the response to surface the error
      lastErr = res;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr instanceof Response) return lastErr;
  throw lastErr || new Error('Network error');
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch {
    return null;
  }
}

function loginUser(user) {
  localStorage.setItem('currentUser', JSON.stringify(user));
  // Admins go straight to dashboard; others follow redirect param or shop
  if (user && (user.isAdmin === true || user.is_admin === true)) {
    window.location.href = 'admin.html';
    return;
  }
  const redirectTo = new URLSearchParams(window.location.search).get('redirect') || 'shop.html';
  window.location.href = redirectTo;
}

// API call to server for login
async function authenticateUser(identifier, password) {
  try {
    const response = await fetchWithFallback(`/api/users/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
  body: JSON.stringify({ identifier, password })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      return data.user;
    } else {
      throw new Error(data.message || 'Login failed');
    }
  } catch (error) {
    throw error;
  }
}

// API call to server for registration
async function registerUser(email, password, name) {
  try {
    const response = await fetchWithFallback(`/api/users/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
  body: JSON.stringify({ email, password, name })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      return data.user;
    } else {
      throw new Error(data.message || 'Registration failed');
    }
  } catch (error) {
    throw error;
  }
}

function toggleMode() {
  isRegisterMode = !isRegisterMode;
  const title = document.getElementById('auth-title');
  const nameField = document.getElementById('name-field');
  const submitBtn = document.querySelector('button[type="submit"]');
  const toggleText = document.getElementById('toggle-text');
  const toggleLink = document.getElementById('toggle-link');

  if (isRegisterMode) {
    title.textContent = 'Sign Up';
    nameField.style.display = 'block';
    submitBtn.textContent = 'Sign Up';
    toggleText.textContent = 'Already have an account?';
    toggleLink.textContent = 'Login';
  } else {
    title.textContent = 'Login';
    nameField.style.display = 'none';
    submitBtn.textContent = 'Login';
    toggleText.textContent = "Don't have an account?";
    toggleLink.textContent = 'Sign up';
  }
}

// Demo account helper: logs in, or creates then logs in
async function useDemoAccount() {
  const demoEmail = 'demo@ezsportsapp.test';
  const demoPass = 'demo1234';
  try {
    const user = await authenticateUser(demoEmail, demoPass);
    loginUser(user);
    return;
  } catch (e) {
    // try to register then login
    try {
      const user = await registerUser(demoEmail, demoPass, 'Demo User');
      loginUser(user);
    } catch (e2) {
      showMessage('Unable to use demo account');
    }
  }
}

function showMessage(text, isError = true) {
  const msg = document.getElementById('auth-message');
  msg.textContent = text;
  msg.style.color = isError ? 'red' : 'green';
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('auth-form');
  const toggleLink = document.getElementById('toggle-link');
  const peek = document.getElementById('peek-password');
  const demoBtn = document.getElementById('demo-login');

  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    toggleMode();
  });

  if (peek) {
    peek.addEventListener('change', () => {
      const pw = document.getElementById('password');
      pw.type = peek.checked ? 'text' : 'password';
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      showMessage('Signing in to demo...', false);
      await useDemoAccount();
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
  const identifier = document.getElementById('identifier').value;
    const password = document.getElementById('password').value;
    const name = document.getElementById('name').value;

    try {
      if (isRegisterMode) {
        // Registration
        if (!name.trim()) {
          showMessage('Please enter your full name');
          return;
        }
        
        showMessage('Creating account...', false);
  // Use identifier as email for signup
  const newUser = await registerUser(identifier, password, name.trim());
        showMessage('Account created successfully!', false);
        setTimeout(() => loginUser(newUser), 1000);
        
      } else {
        // Login
        showMessage('Logging in...', false);
  const user = await authenticateUser(identifier, password);
        loginUser(user);
      }
    } catch (error) {
      showMessage(error.message || 'An error occurred');
    }
  });
});
