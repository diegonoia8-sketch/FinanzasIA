/**
 * toast.js — Sistema premium de notificaciones
 */

let toastContainer = null;

const getContainer = () => {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toastContainer';
        toastContainer.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none';
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
};

export const showToast = (message, type = 'success', duration = 3500) => {
    const container = getContainer();
    const toast = document.createElement('div');

    const styles = {
        success: { bg: 'bg-gray-900', icon: '✓', iconColor: 'text-emerald-400', border: 'border-emerald-500/30' },
        error: { bg: 'bg-gray-900', icon: '✕', iconColor: 'text-red-400', border: 'border-red-500/30' },
        warning: { bg: 'bg-gray-900', icon: '⚠', iconColor: 'text-amber-400', border: 'border-amber-500/30' },
        info: { bg: 'bg-gray-900', icon: 'ℹ', iconColor: 'text-blue-400', border: 'border-blue-500/30' },
    };
    const s = styles[type] || styles.success;

    toast.className = `${s.bg} border ${s.border} text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 min-w-[240px] max-w-[340px] pointer-events-auto transform translate-x-full opacity-0 transition-all duration-300`;
    toast.innerHTML = `
        <span class="${s.iconColor} text-lg font-black w-6 h-6 flex items-center justify-center bg-white/10 rounded-full flex-shrink-0">${s.icon}</span>
        <span class="text-sm font-medium leading-tight">${message}</span>
    `;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.remove('translate-x-full', 'opacity-0');
        });
    });

    // Auto dismiss
    setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, duration);

    return toast;
};

export const showSaveToast = (label = 'transacción') => showToast(`${label} guardada correctamente`, 'success');
export const showDeleteToast = () => showToast('Registro eliminado', 'warning');
export const showErrorToast = (msg) => showToast(msg || 'Ocurrió un error', 'error');
export const showInfoToast = (msg) => showToast(msg, 'info');
