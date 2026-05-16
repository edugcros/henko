import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  IconButton,
  CircularProgress,
  Button,
} from '@mui/material';
import { CloudUpload, Delete, Image as ImageIcon } from '@mui/icons-material';

const ImageUploader = ({
  value,
  onChange,
  label = 'imagen',
  onUpload, // 🔥 inyectable (S3, Cloudinary, etc)
  maxSizeMB = 5,
}) => {
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef();

  // 🔥 Cleanup URL.createObjectURL
  useEffect(() => {
    return () => {
      if (value?.url?.startsWith('blob:')) {
        URL.revokeObjectURL(value.url);
      }
    };
  }, [value]);

  const validateFile = (file) => {
    if (!file.type.startsWith('image/')) {
      return 'Solo se permiten imágenes';
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      return `Máximo ${maxSizeMB}MB`;
    }
    return null;
  };

  const handleUpload = async (file) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setUploading(true);

    try {
      let result;

      if (onUpload) {
        // 🔥 producción real
        result = await onUpload(file);
      } else {
        // fallback dev
        await new Promise((r) => setTimeout(r, 800));
        result = {
          public_id: `temp_${Date.now()}`,
          url: URL.createObjectURL(file),
        };
      }

      onChange(result);
    } catch (err) {
      setError('Error subiendo imagen');
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const removeImage = () => {
    onChange(null);
    setError(null);
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>

      <Box
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current.click()}
        sx={{
          mt: 1,
          p: 2,
          border: '1px dashed',
          borderColor: dragging ? 'primary.main' : 'divider',
          borderRadius: 2,
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 0.2s',
          bgcolor: dragging ? 'action.hover' : 'background.paper',
        }}
      >
        {uploading ? (
          <CircularProgress size={28} />
        ) : value?.url ? (
          <Box sx={{ position: 'relative' }}>
            <Box
              component="img"
              src={value.url}
              alt={label}
              sx={{
                maxWidth: '100%',
                maxHeight: 160,
                borderRadius: 1,
              }}
            />

            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                removeImage();
              }}
              sx={{
                position: 'absolute',
                top: 6,
                right: 6,
                bgcolor: 'rgba(0,0,0,0.5)',
                color: '#fff',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
              }}
            >
              <Delete fontSize="small" />
            </IconButton>
          </Box>
        ) : (
          <Box>
            <ImageIcon sx={{ fontSize: 32, color: 'text.secondary', mb: 1 }} />
            <Typography variant="body2">
              Arrastrá o hacé click para subir
            </Typography>
            <Typography variant="caption" color="text.secondary">
              PNG, JPG hasta {maxSizeMB}MB
            </Typography>
          </Box>
        )}
      </Box>

      <input
        ref={inputRef}
        type="file"
        hidden
        accept="image/*"
        onChange={handleFileSelect}
      />

      {error && (
        <Typography variant="caption" color="error" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}

      {value?.url && !uploading && (
        <Button
          size="small"
          onClick={() => inputRef.current.click()}
          sx={{ mt: 1 }}
        >
          Reemplazar
        </Button>
      )}
    </Box>
  );
};

export default ImageUploader;