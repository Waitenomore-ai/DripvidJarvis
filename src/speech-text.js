'use strict';

function cleanSpeechText(value) {
  return String(value || '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[ \t]*\/\/[ \t]*/g, ' ')
    .replace(/[ \t]*\|[ \t]*/g, '. ')
    .replace(/[ \t]*[-*_]{3,}[ \t]*/g, '. ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/(?:\.\s*){2,}/g, '. ')
    .trim();
}

module.exports = {
  cleanSpeechText
};
