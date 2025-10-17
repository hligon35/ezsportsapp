const express = require('express');
const router = express.Router();
const UserService = require('../services/UserService');
const EmailService = require('../services/EmailService');
const { signToken, requireAdmin, requireAuth, setAuthCookie, clearAuthCookie, getUserFromRequest } = require('../middleware/auth');

const userService = new UserService();
const emailService = new EmailService();

// Register new user (requires firstName, lastName, email, password; optional password2 for confirmation)
router.post('/register', async (req, res) => {
  try {
    const { email, password, password2, firstName, lastName, name } = req.body;
    const fn = (firstName || '').trim();
    const ln = (lastName || '').trim();

    if (!email || !password || !(fn && ln)) {
      return res.status(400).json({ message: 'First name, last name, email, and password are required' });
    }
    if (typeof password2 === 'string' && password2 !== password) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const fullName = (name && name.trim()) || `${fn} ${ln}`.trim();
    const user = await userService.register({ email, password, name: fullName, firstName: fn, lastName: ln });
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

// Admin: Get all users (use shared admin middleware)
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
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

// Forgot password: request reset link
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const { token, email: userEmail } = await userService.createResetToken(email);
    // Build reset URL
  const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const url = new URL('/reset-password.html', base);
    url.searchParams.set('token', token);
    // Queue email (replace with real provider later)
    await emailService.queue({
      to: userEmail,
      subject: 'Reset your EZ Sports Netting password',
      text: `Click the link to reset your password: ${url.toString()} (valid for 1 hour)`,
      html: `<p>Click the link to reset your password:</p><p><a href="${url.toString()}">${url.toString()}</a></p><p>This link is valid for 1 hour.</p>`,
      tags: ['password-reset']
    });
    res.json({ message: 'If an account exists for this email, you will receive a reset link.' });
  } catch (err) {
    // Respond generically to avoid email enumeration
    res.json({ message: 'If an account exists for this email, you will receive a reset link.' });
  }
});

// Reset password: confirm with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password, password2 } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Token and new password are required' });
    if (typeof password2 === 'string' && password2 !== password) return res.status(400).json({ message: 'Passwords do not match' });
    await userService.resetPasswordWithToken(token, password);
    res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});