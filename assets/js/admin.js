// Admin panel functionality
let currentEditingProduct = null;

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch {
    return null;
  }
}

function getProducts() {
  try {
    return JSON.parse(localStorage.getItem('adminProducts') || '[]');
  } catch {
    return [];
  }
}

function saveProducts(products) {
  localStorage.setItem('adminProducts', JSON.stringify(products));
  // Also update the main PRODUCTS array for the shop
  updateShopProducts(products);
}

function updateShopProducts(products) {
  // Convert admin products to shop format
  const shopProducts = products.map(p => ({
    id: p.id,
    title: p.name,
    price: p.price,
    category: p.category,
    img: p.image || 'https://source.unsplash.com/600x400/?product',
    description: p.description,
    stock: p.stock
  }));
  localStorage.setItem('shopProducts', JSON.stringify(shopProducts));
}

function getOrders() {
  try {
    return JSON.parse(localStorage.getItem('orders') || '[]');
  } catch {
    return [];
  }
}

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem('users') || '[]');
  } catch {
    return [];
  }
}

function generateId() {
  return 'prod-' + Date.now();
}

function showSection(section) {
  // Hide all sections
  document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.admin-nav button').forEach(b => b.classList.remove('active'));
  
  // Show selected section
  document.getElementById(section + '-section').style.display = 'block';
  event.target.classList.add('active');
  
  // Load data for section
  if (section === 'products') renderProducts();
  if (section === 'orders') renderOrders();
  if (section === 'users') renderUsers();
}

function renderProducts() {
  const products = getProducts();
  const list = document.getElementById('products-list');
  
  if (!products.length) {
    list.innerHTML = '<p>No products yet. Add your first product above.</p>';
    return;
  }
  
  list.innerHTML = products.map(p => `
    <div class="product-item">
      <div>
        <strong>${p.name}</strong> - $${p.price}
        <br><small>${p.category} | Stock: ${p.stock || 0}</small>
      </div>
      <div>
        <button class="btn btn-ghost" onclick="editProduct('${p.id}')">Edit</button>
        <button class="btn btn-ghost" onclick="deleteProduct('${p.id}')" style="color:red;">Delete</button>
      </div>
    </div>
  `).join('');
}

function renderOrders() {
  const orders = getOrders();
  const list = document.getElementById('orders-list');
  
  if (!orders.length) {
    list.innerHTML = '<p>No orders yet.</p>';
    return;
  }
  
  list.innerHTML = orders.map(order => `
    <div class="product-item">
      <div>
        <strong>Order #${order.id}</strong>
        <br><small>${new Date(order.date).toLocaleString()}</small>
        <br>Items: ${order.items.map(i => `${i.qty}x ${i.id}`).join(', ')}
      </div>
      <div>
        <strong>$${order.total.toFixed(2)}</strong>
      </div>
    </div>
  `).join('');
}

function renderUsers() {
  const users = getUsers();
  const list = document.getElementById('users-list');
  
  if (!users.length) {
    list.innerHTML = '<p>No users registered yet.</p>';
    return;
  }
  
  list.innerHTML = users.map(user => `
    <div class="product-item">
      <div>
        <strong>${user.name}</strong> (${user.email})
        <br><small>${user.isAdmin ? 'Admin' : 'Customer'}</small>
      </div>
      <div>
        <small>ID: ${user.id}</small>
      </div>
    </div>
  `).join('');
}

function addProduct(productData) {
  const products = getProducts();
  const newProduct = {
    id: generateId(),
    ...productData,
    createdAt: new Date().toISOString()
  };
  products.push(newProduct);
  saveProducts(products);
  renderProducts();
}

function editProduct(id) {
  const products = getProducts();
  const product = products.find(p => p.id === id);
  if (!product) return;
  
  currentEditingProduct = id;
  document.getElementById('product-name').value = product.name;
  document.getElementById('product-price').value = product.price;
  document.getElementById('product-image').value = product.image || '';
  document.getElementById('product-category').value = product.category;
  document.getElementById('product-description').value = product.description || '';
  document.getElementById('product-stock').value = product.stock || 0;
  
  document.querySelector('#product-form button[type="submit"]').textContent = 'Update Product';
  document.getElementById('cancel-edit').style.display = 'block';
}

function updateProduct(id, productData) {
  const products = getProducts();
  const index = products.findIndex(p => p.id === id);
  if (index !== -1) {
    products[index] = { ...products[index], ...productData };
    saveProducts(products);
    renderProducts();
  }
}

function deleteProduct(id) {
  if (!confirm('Are you sure you want to delete this product?')) return;
  
  const products = getProducts().filter(p => p.id !== id);
  saveProducts(products);
  renderProducts();
}

function cancelEdit() {
  currentEditingProduct = null;
  document.getElementById('product-form').reset();
  document.querySelector('#product-form button[type="submit"]').textContent = 'Add Product';
  document.getElementById('cancel-edit').style.display = 'none';
}

// Initialize admin panel
document.addEventListener('DOMContentLoaded', () => {
  const user = getCurrentUser();
  
  // Check if user is admin
  if (!user || !user.isAdmin) {
    alert('Access denied. Admin privileges required.');
    window.location.href = 'login.html?redirect=admin.html';
    return;
  }
  
  // Product form submission
  document.getElementById('product-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const productData = {
      name: document.getElementById('product-name').value,
      price: parseFloat(document.getElementById('product-price').value),
      image: document.getElementById('product-image').value,
      category: document.getElementById('product-category').value,
      description: document.getElementById('product-description').value,
      stock: parseInt(document.getElementById('product-stock').value) || 0
    };
    
    if (currentEditingProduct) {
      updateProduct(currentEditingProduct, productData);
      cancelEdit();
    } else {
      addProduct(productData);
      document.getElementById('product-form').reset();
    }
  });
  
  // Logout functionality
  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
  });
  
  // Load initial data
  renderProducts();
});

// Make functions global for onclick handlers
window.showSection = showSection;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.cancelEdit = cancelEdit;
