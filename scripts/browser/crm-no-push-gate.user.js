// ==UserScript==
// @name         CRM — без примусових сповіщень
// @namespace    adsbot-local
// @version      1.0.0
// @description  Прибирає вікно обов'язкових сповіщень до блокування сторінки.
// @match        https://crm.we-can.xyz/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
    'use strict';
    if (location.origin !== 'https://crm.we-can.xyz' || window.top !== window.self) return;

    // Прибираємо вікно під час розбору HTML, до виконання відкладеного скрипту сайту.
    const removeGate = () => document.getElementById('push-gate')?.remove();
    const observer = new MutationObserver(removeGate);
    observer.observe(document, { childList: true, subtree: true });
    removeGate();

    // Після початкового завантаження спостерігач більше не потрібен.
    document.addEventListener('DOMContentLoaded', () => {
        removeGate();
        observer.disconnect();
    }, { once: true });
})();
