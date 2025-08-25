const express = require('express');
const router = express.Router();
const UserService = require('../services/UserService');
const { signToken, requireAdmin, requireAuth, setAuthCookie, clearAuthCookie, getUserFromRequest } = require('../middleware/auth');

const userService = new UserService();

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email, password, and name are required' });
    }

  const user = await userService.register({ email, password, name });
  const token = signToken(user);
  setAuthCookie(res, token);
  res.status(201).json({ message: 'User registered successfully', user, token });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Login user (accept email or username as "identifier")
// Support preflight for login from browsers
router.options('/login', (req, res) => res.sendStatus(200));

router.post('/login', async (req, res) => {
  try {
    const { identifier, password, email } = req.body;
    const loginId = identifier || email; // support both field names from clients

    if (!loginId || !password) {
      return res.status(400).json({ message: 'Identifier (email or username) and password are required' });
    }

  const user = await userService.login(loginId, password);
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ message: 'Login successful', user, token });
  } catch (err) {
    res.status(401).json({ message: err.message });
  }
});

// Get user profile
router.get('/profile/:id', requireAuth, async (req, res) => {
  try {
    const user = await userService.getUserById(parseInt(req.params.id));
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update user profile
router.put('/profile/:id', requireAuth, async (req, res) => {
  try {
    const updatedUser = await userService.updateUser(parseInt(req.params.id), req.body);
    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Change password
router.post('/change-password/:id', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Old and new passwords are required' });
    }

    await userService.changePassword(parseInt(req.params.id), oldPassword, newPassword);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Admin: Get all users
router.get('/admin/all', requireAuth, async (req, res) => {
  try {
    // Check if user is admin
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
    if (!decoded.isAdmin && !decoded.is_admin && decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const users = await userService.getAllUsers();
    // Remove password hashes from response
    const safeUsers = users.map(user => ({
      ...user,
      password: undefined
    }));
    res.json(safeUsers);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Logout (support CORS preflight as needed)
router.options('/logout', (req, res) => res.sendStatus(200));
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ message: 'Logged out' });
});

// Current session info (for SSO-enabled apps)
router.get('/me', (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: 'Unauthorized' });
  res.json({ user });
});

// Refresh token (rotate without changing user payload)
router.post('/refresh', requireAuth, (req, res) => {
  const token = signToken({ id: req.user.id, email: req.user.email, isAdmin: req.user.isAdmin });
  setAuthCookie(res, token);
  res.json({ token });
});

// Delete user (admin only)
router.delete('/admin/:id', requireAdmin, async (req, res) => {
  try {
    const success = await userService.deleteUser(parseInt(req.params.id));
    if (!success) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;