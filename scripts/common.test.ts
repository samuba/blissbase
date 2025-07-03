import { describe, it, expect } from 'vitest';
import { linkify } from './common';

describe('linkify', () => {
    it('should convert plain URLs to clickable links', () => {
        const input = 'Check out https://example.com for more info';
        const expected = 'Check out <a href="https://example.com" target="_blank">https://example.com</a> for more info';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle multiple URLs in the same text', () => {
        const input = 'Visit https://example.com and https://test.org for more details';
        const expected = 'Visit <a href="https://example.com" target="_blank">https://example.com</a> and <a href="https://test.org" target="_blank">https://test.org</a> for more details';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs with query parameters', () => {
        const input = 'Go to https://example.com/path?param=value&other=123';
        const expected = 'Go to <a href="https://example.com/path?param=value&amp;other=123" target="_blank">https://example.com/path?param=value&amp;other=123</a>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs with fragments', () => {
        const input = 'See https://example.com/page#section for details';
        const expected = 'See <a href="https://example.com/page#section" target="_blank">https://example.com/page#section</a> for details';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle both HTTP and HTTPS URLs', () => {
        const input = 'HTTP: http://example.com and HTTPS: https://secure.com';
        const expected = 'HTTP: <a href="http://example.com" target="_blank">http://example.com</a> and HTTPS: <a href="https://secure.com" target="_blank">https://secure.com</a>';
        expect(linkify(input)).toBe(expected);
    });

    it('should not modify text that already contains links', () => {
        const input = '<a href="https://example.com">Click here</a>';
        expect(linkify(input)).toBe(input);
    });

    it('should not modify text inside existing link tags', () => {
        const input = '<a href="https://example.com">Visit https://test.org</a>';
        expect(linkify(input)).toBe(input);
    });

    it('should handle nested HTML elements', () => {
        const input = '<div>Check out <span>https://example.com</span> for more info</div>';
        const expected = '<div>Check out <span><a href="https://example.com" target="_blank">https://example.com</a></span> for more info</div>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle complex HTML structure', () => {
        const input = '<div><p>First paragraph with https://example1.com</p><p>Second paragraph with https://example2.com</p></div>';
        const expected = '<div><p>First paragraph with <a href="https://example1.com" target="_blank">https://example1.com</a></p><p>Second paragraph with <a href="https://example2.com" target="_blank">https://example2.com</a></p></div>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs at the beginning of text', () => {
        const input = 'https://example.com is a great website';
        const expected = '<a href="https://example.com" target="_blank">https://example.com</a> is a great website';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs at the end of text', () => {
        const input = 'Visit our website at https://example.com';
        const expected = 'Visit our website at <a href="https://example.com" target="_blank">https://example.com</a>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs that are the entire text', () => {
        const input = 'https://example.com';
        const expected = '<a href="https://example.com" target="_blank">https://example.com</a>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs with special characters', () => {
        const input = 'Check https://example.com/path-with-dashes_and_underscores?param=value#section';
        const expected = 'Check <a href="https://example.com/path-with-dashes_and_underscores?param=value#section" target="_blank">https://example.com/path-with-dashes_and_underscores?param=value#section</a>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs with port numbers', () => {
        const input = 'Connect to https://example.com:8080/api';
        const expected = 'Connect to <a href="https://example.com:8080/api" target="_blank">https://example.com:8080/api</a>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs with subdomains', () => {
        const input = 'Visit https://sub.example.com/path';
        const expected = 'Visit <a href="https://sub.example.com/path" target="_blank">https://sub.example.com/path</a>';
        expect(linkify(input)).toBe(expected);
    });

    it('should not modify text without URLs', () => {
        const input = 'This is just plain text without any URLs';
        expect(linkify(input)).toBe(input);
    });

    it('should not modify text with invalid URLs', () => {
        const input = 'This contains invalid: not-a-url and also: ftp://example.com';
        const expected = 'This contains invalid: not-a-url and also: ftp://example.com';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle mixed content with some existing links', () => {
        const input = '<div><a href="https://existing.com">Existing link</a> and new https://new.com</div>';
        const expected = '<div><a href="https://existing.com">Existing link</a> and new <a href="https://new.com" target="_blank">https://new.com</a></div>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs with trailing punctuation', () => {
        const input = 'Visit https://example.com. And https://test.org!';
        const expected = 'Visit <a href="https://example.com." target="_blank">https://example.com.</a> And <a href="https://test.org!" target="_blank">https://test.org!</a>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs with parentheses', () => {
        const input = 'Check (https://example.com) for more info';
        const expected = 'Check (<a href="https://example.com)" target="_blank">https://example.com)</a> for more info';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs with quotes', () => {
        const input = 'Visit "https://example.com" for details';
        const expected = 'Visit "<a href="https://example.com" target="_blank">https://example.com</a>" for details';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle case insensitive URL matching', () => {
        const input = 'Check HTTP://EXAMPLE.COM and https://Test.Org';
        const expected = 'Check <a href="HTTP://EXAMPLE.COM" target="_blank">HTTP://EXAMPLE.COM</a> and <a href="https://Test.Org" target="_blank">https://Test.Org</a>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle empty string input', () => {
        expect(linkify('')).toBe('');
    });

    it('should handle whitespace-only input', () => {
        expect(linkify('   \n\t  ')).toBe('');
    });

    it('should handle URLs with multiple dots', () => {
        const input = 'Visit https://example.co.uk/path';
        const expected = 'Visit <a href="https://example.co.uk/path" target="_blank">https://example.co.uk/path</a>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs with underscores in domain', () => {
        const input = 'Check https://example_test.com';
        const expected = 'Check <a href="https://example_test.com" target="_blank">https://example_test.com</a>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs with hyphens in domain', () => {
        const input = 'Visit https://example-test.com';
        const expected = 'Visit <a href="https://example-test.com" target="_blank">https://example-test.com</a>';
        expect(linkify(input)).toBe(expected);
    });

    it('should handle URLs that begin within a word', () => {
        const input = 'Visithttps://example-test.com';
        const expected = 'Visit<a href="https://example-test.com" target="_blank">https://example-test.com</a>';
        expect(linkify(input)).toBe(expected);
    });
}); 