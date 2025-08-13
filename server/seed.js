// Script to seed products into MongoDB
const mongoose = require('mongoose');
const Product = require('./models/Product');
const products = require('./products-sample.json');

async function seed() {
  await mongoose.connect('mongodb://localhost:27017/ezsports', {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  await Product.deleteMany({});
  await Product.insertMany(products);
  console.log('Seeded products!');
  mongoose.disconnect();
}

seed();
