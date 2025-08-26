// Authentication system using server API
let isRegisterMode = false;
// Detect Live Server (static 5500) so we don't POST to it
const isLiveServer = (location.port === '5500') && (location.protocol.startsWith('http'));
// In Live Server mode, only try the API server(s) on 4242 to avoid 405s on 5500
const API_BASE_CANDIDATES = isLiveServer
  ? ['http://127.0.0.1:4242', 'http://localhost:4242']
  : [''];

async function fetchWithFallback(path, options) {
  let lastErr;
  for (const base of API_BASE_CANDIDATES) {
    try {
      const res = await fetch(`${base}${path}`, options);
      // On any HTTP response, stop retrying and return it (avoid duplicate logs)
      try { window.__API_BASE = base; } catch {}
      return res;
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
  let redirectTo = new URLSearchParams(window.location.search).get('redirect') || 'index.html#catalog';
  // Avoid loops: if a non-admin is sent to admin.html, route to catalog instead
  if (/^\/?admin\.html$/i.test(redirectTo)) {
    redirectTo = 'index.html#catalog';
  }
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
    // Store token for cross-origin admin/API calls
    if (data && data.token) {
      try { localStorage.setItem('authToken', data.token); } catch {}
    }
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
async function registerUser(email, password, name, firstName, lastName, password2) {
  try {
    const response = await fetchWithFallback(`/api/users/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
  body: JSON.stringify({ email, password, name, firstName, lastName, password2 })
    });
    
    const data = await response.json();
    if (data && data.token) {
      try { localStorage.setItem('authToken', data.token); } catch {}
    }
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
  const confirmField = document.getElementById('confirm-field');
  const submitBtn = document.querySelector('button[type="submit"]');
  const toggleText = document.getElementById('toggle-text');
  const toggleLink = document.getElementById('toggle-link');
  const identifierInput = document.getElementById('identifier');
  const fnInput = document.getElementById('firstName');
  const lnInput = document.getElementById('lastName');
  const pw2Input = document.getElementById('password2');

  if (isRegisterMode) {
    title.textContent = 'Sign Up';
  try { document.title = 'Sign Up | EZ Sports Netting'; } catch {}
  nameField.classList.remove('hidden');
    nameField.style.removeProperty('display');
    if (confirmField) {
      confirmField.classList.remove('hidden');
      confirmField.style.removeProperty('display');
    }
    submitBtn.textContent = 'Sign Up';
    toggleText.textContent = 'Already have an account?';
    toggleLink.textContent = 'Login';
  if (identifierInput) identifierInput.placeholder = 'Email';
  if (fnInput) fnInput.required = true;
  if (lnInput) lnInput.required = true;
  if (pw2Input) pw2Input.required = true;
  } else {
    title.textContent = 'Login';
  try { document.title = 'Login | EZ Sports Netting'; } catch {}
  nameField.classList.add('hidden');
    nameField.style.removeProperty('display');
    if (confirmField) {
      confirmField.classList.add('hidden');
      confirmField.style.removeProperty('display');
    }
    submitBtn.textContent = 'Login';
    toggleText.textContent = "Don't have an account?";
    toggleLink.textContent = 'Sign up';
  if (identifierInput) identifierInput.placeholder = 'Email or username';
  if (fnInput) fnInput.required = false;
  if (lnInput) lnInput.required = false;
  if (pw2Input) pw2Input.required = false;
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
  const user = await registerUser(demoEmail, demoPass, 'Demo User', 'Demo', 'User', demoPass);
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

  // start clean in Login mode
  isRegisterMode = false;
  try { document.title = 'Login | EZ Sports Netting'; } catch {}
  const idInput = document.getElementById('identifier');
  if (idInput) idInput.placeholder = 'Email or username';
  const fn = document.getElementById('firstName'); if (fn) fn.required = false;
  const ln = document.getElementById('lastName'); if (ln) ln.required = false;
  const pw2 = document.getElementById('password2'); if (pw2) pw2.required = false;

  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    toggleMode();
  });

  if (peek) {
    const pw = document.getElementById('password');
    const label = document.querySelector('label.auth-peek');
    const setType = () => { pw.type = peek.checked ? 'text' : 'password'; };
    peek.addEventListener('change', setType);
    if (label) {
      label.addEventListener('click', (e) => {
        if (e.target !== peek) {
          e.preventDefault();
          peek.checked = !peek.checked;
          setType();
        }
      });
    }
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
  const firstName = (document.getElementById('firstName')?.value || '').trim();
  const lastName = (document.getElementById('lastName')?.value || '').trim();
  const password2 = (document.getElementById('password2')?.value || '').trim();

    try {
      if (isRegisterMode) {
        // Registration
    if (!firstName || !lastName) return showMessage('Please enter first and last name');
    if (password.length < 6) return showMessage('Password must be at least 6 characters');
    if (password !== password2) return showMessage('Passwords do not match');
        
        showMessage('Creating account...', false);
    // Use identifier as email for signup
  const fullName = `${firstName} ${lastName}`.trim();
  const newUser = await registerUser(identifier, password, fullName, firstName, lastName, password2);
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
