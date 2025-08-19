// Authentication system using server API
let isRegisterMode = false;
const API_BASE = (location.hostname === 'localhost' && location.port === '5500') ? 'http://localhost:4242' : '';

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch {
    return null;
  }
}

function loginUser(user) {
  localStorage.setItem('currentUser', JSON.stringify(user));
  // Redirect to shop or previous page
  const redirectTo = new URLSearchParams(window.location.search).get('redirect') || 'shop.html';
  window.location.href = redirectTo;
}

// API call to server for login
async function authenticateUser(identifier, password) {
  try {
    const response = await fetch(`${API_BASE}/api/users/login`, {
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
    const response = await fetch(`${API_BASE}/api/users/register`, {
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

function showMessage(text, isError = true) {
  const msg = document.getElementById('auth-message');
  msg.textContent = text;
  msg.style.color = isError ? 'red' : 'green';
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('auth-form');
  const toggleLink = document.getElementById('toggle-link');

  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    toggleMode();
  });

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
