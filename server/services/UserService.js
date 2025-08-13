// User Service - Handle user operations
const DatabaseManager = require('../database/DatabaseManager');
const bcrypt = require('bcrypt');

class UserService {
  constructor() {
    this.db = new DatabaseManager();
    this.saltRounds = 10;
  }

  // Register a new user
  async register(userData) {
    try {
      // Check if user already exists
      const existingUser = await this.db.findOne('users', { email: userData.email });
      if (existingUser) {
        throw new Error('User already exists with this email');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, this.saltRounds);

      // Create user object
      const newUser = {
        email: userData.email,
        password: hashedPassword,
        name: userData.name,
        isAdmin: userData.email === 'admin@ezsports.com', // Auto-admin for specific email
        lastLogin: null
      };

      // Insert user
      const user = await this.db.insert('users', newUser);
      
      // Return user without password
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      throw error;
    }
  }

  // Authenticate user
  async login(email, password) {
    try {
      const user = await this.db.findOne('users', { email });
      if (!user) {
        throw new Error('Invalid email or password');
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        throw new Error('Invalid email or password');
      }

      // Update last login
      await this.db.update('users', { id: user.id }, { lastLogin: new Date().toISOString() });

      // Return user without password
      const { password: _, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      throw error;
    }
  }

  // Get user by ID
  async getUserById(id) {
    try {
      const user = await this.db.findOne('users', { id });
      if (!user) {
        return null;
      }
      
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      throw error;
    }
  }

  // Get all users (admin only)
  async getAllUsers() {
    try {
      const users = await this.db.find('users');
      return users.map(user => {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
      });
    } catch (error) {
      throw error;
    }
  }

  // Update user
  async updateUser(id, updateData) {
    try {
      // Don't allow password updates through this method
      delete updateData.password;
      delete updateData.id;

      const updated = await this.db.update('users', { id }, updateData);
      if (!updated) {
        throw new Error('User not found');
      }

      return await this.getUserById(id);
    } catch (error) {
      throw error;
    }
  }

  // Change password
  async changePassword(id, oldPassword, newPassword) {
    try {
      const user = await this.db.findOne('users', { id });
      if (!user) {
        throw new Error('User not found');
      }

      const isValidPassword = await bcrypt.compare(oldPassword, user.password);
      if (!isValidPassword) {
        throw new Error('Invalid current password');
      }

      const hashedNewPassword = await bcrypt.hash(newPassword, this.saltRounds);
      await this.db.update('users', { id }, { password: hashedNewPassword });

      return true;
    } catch (error) {
      throw error;
    }
  }

  // Delete user
  async deleteUser(id) {
    try {
      const deletedCount = await this.db.delete('users', { id });
      return deletedCount > 0;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = UserService;
