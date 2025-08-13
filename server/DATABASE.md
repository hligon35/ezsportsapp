# EZ Sports Database System

## Overview
This is a JSON-based persistent storage system designed for easy migration to a proper database later. All data is stored in organized JSON files with a comprehensive service layer.

## Database Structure

```
server/
├── database/
│   ├── DatabaseManager.js     # Core database operations
│   ├── schema.json           # Database schema and metadata
│   ├── users.json           # User accounts
│   ├── products.json        # Product catalog
│   ├── orders.json          # Customer orders
│   └── backups/             # Automatic backups
├── services/
│   ├── UserService.js       # User management
│   ├── ProductService.js    # Product management
│   └── OrderService.js      # Order management
└── routes/
    ├── users.js            # User API endpoints
    ├── products.js         # Product API endpoints
    └── orders.js           # Order API endpoints
```

## Features

### 🔐 User Management
- **Secure Authentication**: bcrypt password hashing
- **Role-based Access**: Admin and customer roles
- **Profile Management**: Update profiles, change passwords
- **Auto-admin**: admin@ezsports.com automatically gets admin privileges

### 📦 Product Management
- **Full CRUD Operations**: Create, read, update, delete products
- **Inventory Tracking**: Real-time stock management
- **Category Organization**: Bats, gloves, netting, helmets
- **Search & Filter**: Find products by name, description, category
- **Stock Alerts**: Track low inventory items

### 🛒 Order Management
- **Order Processing**: Complete order lifecycle
- **Stock Validation**: Automatic inventory checks
- **Order Status**: pending → processing → shipped → delivered
- **Order Cancellation**: Restore inventory on cancellation
- **Revenue Tracking**: Order statistics and analytics

### 💾 Data Persistence
- **JSON Storage**: Human-readable, easy to backup
- **Auto-increment IDs**: Consistent unique identifiers
- **Timestamps**: Created/updated tracking
- **Metadata**: Schema versioning and modification tracking
- **Backup System**: Automatic timestamped backups

## Quick Start

### 1. Initialize Database
```bash
npm run init-db
```

### 2. Start Server
```bash
npm start
```

### 3. Check Database Status
```bash
npm run db:stats
```

## API Endpoints

### Users
- `POST /api/users/register` - Register new user
- `POST /api/users/login` - User login
- `GET /api/users/profile/:id` - Get user profile
- `PUT /api/users/profile/:id` - Update profile
- `POST /api/users/change-password/:id` - Change password
- `GET /api/users/admin/all` - Get all users (admin)

### Products
- `GET /api/products` - Get all products
- `GET /api/products/:id` - Get product by ID
- `POST /api/products` - Create product (admin)
- `PUT /api/products/:id` - Update product (admin)
- `PATCH /api/products/:id/stock` - Update stock
- `DELETE /api/products/:id` - Delete product (admin)
- `GET /api/products/admin/stats` - Product statistics (admin)

### Orders
- `POST /api/orders` - Create order
- `GET /api/orders/:id` - Get order by ID
- `GET /api/orders/user/:userId` - Get user orders
- `GET /api/orders/email/:email` - Get orders by email
- `PATCH /api/orders/:id/status` - Update order status (admin)
- `PATCH /api/orders/:id/cancel` - Cancel order
- `GET /api/orders/admin/all` - Get all orders (admin)

## Database Commands

### View Statistics
```bash
npm run db:stats
```
Shows users, products, orders count and breakdowns.

### Create Backup
```bash
npm run db:backup
```
Creates timestamped backup in `database/backups/`.

### Reset Database
```bash
npm run db:reset
```
⚠️ **Warning**: Clears all data! Use only in development.

### Initialize Database
```bash
npm run init-db
```
Sets up database with default admin user.

## Default Accounts

After initialization:
- **Admin**: admin@ezsports.com / admin123
- **Demo User**: demo@user.com / demo123

## Data Migration

When ready to migrate to a proper database:

1. **Export Data**: Use backup system to create JSON exports
2. **Schema Mapping**: Use schema.json for table structure
3. **Service Layer**: Keep existing services, update DatabaseManager
4. **Zero Downtime**: Services abstract database operations

## File Structure

### users.json
```json
{
  "id": 1001,
  "email": "user@example.com",
  "password": "hashed_password",
  "name": "User Name",
  "isAdmin": false,
  "createdAt": "2025-08-12T00:00:00.000Z",
  "lastLogin": "2025-08-12T12:00:00.000Z"
}
```

### products.json
```json
{
  "id": "prod-2001",
  "name": "Product Name",
  "description": "Product description",
  "price": 299.95,
  "image": "image_url",
  "category": "bats",
  "stock": 10,
  "isActive": true,
  "createdAt": "2025-08-12T00:00:00.000Z",
  "updatedAt": "2025-08-12T00:00:00.000Z"
}
```

### orders.json
```json
{
  "id": 3001,
  "userId": 1001,
  "userEmail": "user@example.com",
  "items": [
    {
      "productId": "prod-2001",
      "productName": "Product Name",
      "price": 299.95,
      "quantity": 1,
      "subtotal": 299.95
    }
  ],
  "total": 299.95,
  "status": "pending",
  "shippingAddress": {},
  "createdAt": "2025-08-12T00:00:00.000Z"
}
```

## Security Features

- **Password Hashing**: bcrypt with salt rounds
- **Input Validation**: Required field validation
- **Error Handling**: Comprehensive error messages
- **Data Integrity**: Automatic stock validation
- **Backup System**: Prevent data loss

## Performance

- **Memory Efficient**: Loads only needed data
- **Fast Queries**: In-memory filtering and searching
- **Concurrent Safe**: Atomic file operations
- **Scalable**: Easy to partition by collection

## Monitoring

Monitor database health with:
```bash
npm run db:stats
```

Regular backups recommended:
```bash
npm run db:backup
```

## Migration Path

This system is designed for easy migration to:
- **MongoDB**: Similar document structure
- **PostgreSQL**: JSON columns or normalized tables
- **MySQL**: Structured tables with JSON fields
- **Firebase**: Direct JSON import
- **Supabase**: PostgreSQL with JSON support

The service layer abstracts all database operations, making migration seamless.
