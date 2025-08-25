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
      // Check if user already exists (by email or username)
      const existingUserByEmail = await this.db.findOne('users', { email: userData.email });
      const existingUserByUsername = userData.username ? await this.db.findOne('users', { username: userData.username }) : null;
      if (existingUserByEmail) {
        throw new Error('User already exists with this email');
      }
      if (existingUserByUsername) {
        throw new Error('User already exists with this username');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, this.saltRounds);

      // Normalize name: accept either single name or first/last
      const fullName = (userData.name || [userData.firstName, userData.lastName].filter(Boolean).join(' ')).trim();
      const [firstName, ...rest] = fullName.split(' ');
      const lastName = rest.join(' ').trim() || undefined;

      // Create user object
      const newUser = {
        email: userData.email,
        username: userData.username || undefined,
        password: hashedPassword,
        name: fullName || undefined,
        firstName: firstName || undefined,
        lastName: lastName,
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

  // Authenticate user (allow login by email or username)
  async login(identifier, password) {
    try {
      const id = String(identifier || '').trim();
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Try by email (exact, then case-insensitive), then by username
      let userByEmail = await this.db.findOne('users', { email: id });
      if (!userByEmail && id) {
        userByEmail = await this.db.findOne('users', { email: { $regex: `^${esc(id)}$`, $options: 'i' } });
      }
      let userByUsername = await this.db.findOne('users', { username: id });
      if (!userByUsername && id) {
        userByUsername = await this.db.findOne('users', { username: { $regex: `^${esc(id)}$`, $options: 'i' } });
      }
      const user = userByEmail || userByUsername;
      if (!user) {
        throw new Error('Invalid credentials');
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        throw new Error('Invalid credentials');
      }

      // Update last login
      await this.db.update('users', { id: user.id }, { lastLogin: new Date().toISOString() });

  // Return user without password, ensuring expected fields
  const { password: _, ...userWithoutPassword } = user;
  const computedName = user.name || [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || 'User';
  const computedIsAdmin = Boolean(user.isAdmin || user.role === 'admin' || user.email === 'admin@ezsports.com');
  return { ...userWithoutPassword, name: computedName, isAdmin: computedIsAdmin };
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