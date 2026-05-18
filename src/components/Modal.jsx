import './Modal.css';

export default function Modal({ title, children, onClose, wide = false }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-box card ${wide ? 'modal-box--wide' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        {(title || onClose) && (
          <div className="modal-header">
            {title && <h3 className="modal-title">{title}</h3>}
            {onClose && (
              <button
                className="btn btn-ghost modal-close-btn"
                onClick={onClose}
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}