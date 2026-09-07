const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  userId:   { type: Number, required: true, unique: true },
  fullName: { type: String, default: '' },
  username: { type: String, default: null },
  phone:    { type: String, default: null },
  adId:     { type: String, default: null },
  // 🚨 Added so a DET ad's leads can be told apart from a TOEFL ad's — see
  // server.js's `productFor(adId)` for the ONE place this is derived (an
  // `adId` starting with "det_" — a plain naming convention, not guessed
  // from free text elsewhere). Defaults to 'TOEFL' so every lead captured
  // before this field existed reads correctly with no backfill.
  //
  // ⚠️ THE BOT DOES BRANCH ITS MESSAGES ON THIS (see DET_WELCOME_TEXT etc. in
  // server.js), but that DET copy is a FIRST DRAFT, not owner-reviewed the
  // way the TOEFL copy presumably was before it shipped — see server.js's
  // own comment above those constants. No `det_`-prefixed adId has ever
  // actually been used for a real ad; get the copy approved before one is.
  product:  { type: String, enum: ['TOEFL', 'DET'], default: 'TOEFL' },
  createdAt:{ type: Date,   default: Date.now },
});

module.exports = mongoose.model('Lead', leadSchema);
