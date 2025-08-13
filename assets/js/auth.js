// Simple authentication system using localStorage
let isRegisterMode = false;

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch {
    return null;
  }
}

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem('users') || '[]');
  } catch {
    return [];
  }
}

function saveUser(user) {
  const users = getUsers();
  users.push(user);
  localStorage.setItem('users', JSON.stringify(users));
}

function authenticateUser(email, password) {
  const users = getUsers();
  return users.find(u => u.email === email && u.password === password);
}

function loginUser(user) {
  localStorage.setItem('currentUser', JSON.stringify(user));
  // Redirect to shop or previous page
  const redirectTo = new URLSearchParams(window.location.search).get('redirect') || 'shop.html';
  window.location.href = redirectTo;
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

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const name = document.getElementById('name').value;

    if (isRegisterMode) {
      // Registration
      if (!name.trim()) {
        showMessage('Please enter your full name');
        return;
      }
      if (getUsers().find(u => u.email === email)) {
        showMessage('Email already exists');
        return;
      }
      const newUser = { 
        id: Date.now(), 
        email, 
        password, 
        name: name.trim(),
        isAdmin: email === 'admin@ezsports.com' // Make first admin
      };
      saveUser(newUser);
      showMessage('Account created successfully!', false);
      setTimeout(() => loginUser(newUser), 1000);
    } else {
      // Login
      const user = authenticateUser(email, password);
      if (user) {
        loginUser(user);
      } else {
        showMessage('Invalid email or password');
      }
    }
  });
});
