// marked is loaded globally via CDN script tag in index.html

export const getTabs = () => document.querySelectorAll('.tab-content');
export const getTabButtons = () => document.querySelectorAll('.tab-button');

export const showTab = (tabId) => {
    getTabs().forEach(tab => tab.classList.add('hidden'));
    document.getElementById(tabId).classList.remove('hidden');
    getTabButtons().forEach(button => button.classList.remove('active'));
    document.querySelectorAll(`.tab-button[data-tab="${tabId}"]`).forEach(btn => btn.classList.add('active'));
};

export const toggleBalancesVisibility = (shouldPixelate) => {
    document.querySelectorAll('.balance-value').forEach(el => 
        shouldPixelate ? el.classList.add('pixelate-text') : el.classList.remove('pixelate-text')
    );
};

export const populateSelectOptions = (selectId, options, includePlaceholder = true, placeholderText = 'Seleccionar...') => {
    const selectElem = document.getElementById(selectId);
    if (!selectElem) return; 
    selectElem.innerHTML = '';
    if (includePlaceholder) selectElem.appendChild(new Option(placeholderText, ''));
    options.forEach(opt => selectElem.appendChild(new Option(opt, opt)));
};

export const addMessageToChat = (chatMessages, text, isUser = false) => {
    const div = document.createElement('div');
    div.className = `p-3 rounded-lg text-sm max-w-[85%] shadow-sm ${isUser ? 'bg-purple-600 text-white self-end' : 'bg-white border border-gray-200 text-gray-800 self-start chat-message'}`;
    if (isUser) { 
        div.textContent = text; 
    } else { 
        // Use global marked from CDN
        div.innerHTML = (typeof marked !== 'undefined') ? marked.parse(text) : text;
    }
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
};

export const showLoadingOverlay = () => {
    const overlay = document.getElementById('pdfLoadingOverlay');
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
};

export const hideLoadingOverlay = () => {
    const overlay = document.getElementById('pdfLoadingOverlay');
    overlay.classList.remove('flex');
    overlay.classList.add('hidden');
};
