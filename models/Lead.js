const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  userId:   { type: Number, required: true, unique: true },
  fullName: { type: String, default: '' },
  username: { type: String, default: null },
  phone:    { type: String, default: null },
  adId:     { type: String, default: null },
  createdAt:{ type: Date,   default: Date.now },
});

module.exports = mongoose.model('Lead', leadSchema);
