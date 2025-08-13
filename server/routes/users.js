const express = require('express');
const router = express.Router();
const UserService = require('../services/UserService');

const userService = new UserService();

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email, password, and name are required' });
    }

    const user = await userService.register({ email, password, name });
    res.status(201).json({ 
      message: 'User registered successfully', 
      user 
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await userService.login(email, password);
    res.json({ 
      message: 'Login successful', 
      user 
    });
  } catch (err) {
    res.status(401).json({ message: err.message });
  }
});

// Get user profile
router.get('/profile/:id', async (req, res) => {
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
router.put('/profile/:id', async (req, res) => {
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
router.post('/change-password/:id', async (req, res) => {
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

// Get all users (admin only)
router.get('/admin/all', async (req, res) => {
  try {
    const users = await userService.getAllUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete user (admin only)
router.delete('/admin/:id', async (req, res) => {
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
