import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import './Modal.css';

const Modal = ({ isOpen, onClose, title, children, size = 'medium' }) => {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Cerrar al hacer click fuera del modal
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Tamaños disponibles
  const sizeClasses = {
    small: 'modal-small',
    medium: 'modal-medium',
    large: 'modal-large',
    full: 'modal-full'
  };

  // Usar portal para renderizar al final del body (mejor z-index)
  const modalContent = (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className={`modal-container ${sizeClasses[size]}`}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button 
            className="modal-close-btn" 
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  );

  // Si no tienes React 18+, cambia createRoot por render
  const modalRoot = document.getElementById('modal-root') || document.body;
  
  return ReactDOM.createPortal(modalContent, modalRoot);
};

export default Modal;