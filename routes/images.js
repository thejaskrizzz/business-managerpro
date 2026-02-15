const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { upload, deleteFromCloudinary } = require('../config/cloudinary');

// Upload image
router.post('/upload', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    res.json({
      message: 'Image uploaded successfully',
      imageUrl: req.file.path,
      publicId: req.file.filename
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ message: 'Failed to upload image' });
  }
});

// Delete image
router.delete('/delete/:publicId', authenticateToken, async (req, res) => {
  try {
    const { publicId } = req.params;
    
    await deleteFromCloudinary(publicId);
    
    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Image delete error:', error);
    res.status(500).json({ message: 'Failed to delete image' });
  }
});

module.exports = router;
