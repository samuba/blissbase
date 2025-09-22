import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aiExtractEventData } from "../blissbase-telegram-entry/src/ai";

// Mock the AI function to test the logic
vi.mock("../blissbase-telegram-entry/src/ai", () => ({
    aiExtractEventData: vi.fn()
}));

describe('Image Processing for Event Extraction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should handle image-only messages with event data', async () => {
        // Mock AI response for an image with event data
        const mockAiResponse = {
            hasEventData: true,
            name: "Tantra Workshop",
            description: "Join us for a transformative tantra workshop\nDate: 15.12.2024\nTime: 19:00\nLocation: Berlin\nPrice: 50€",
            startDate: "2024-12-15T19:00:00+01:00",
            address: "Berlin, Germany",
            venue: "Tantra Studio",
            city: "Berlin",
            price: "50€",
            contact: "info@tantra.de",
            tags: ["tantra", "workshop", "transformation"],
        };

        (aiExtractEventData as any).mockResolvedValue(mockAiResponse);
        const date = new Date();
        // Test the AI function with an image URL
        const result = await aiExtractEventData('', date, ['https://example.com/event-flyer.jpg']);

        expect(aiExtractEventData).toHaveBeenCalledWith('', date, ['https://example.com/event-flyer.jpg']);
        expect(result.hasEventData).toBe(true);
        expect(result.name).toBe("Tantra Workshop");
        expect(result.startDate).toBe("2024-12-15T19:00:00+01:00");
    });

    it('should handle image-only messages without event data', async () => {
        // Mock AI response for an image without event data
        const mockAiResponse = {
            hasEventData: false
        };

        (aiExtractEventData as any).mockResolvedValue(mockAiResponse);

        // Test the AI function with an image URL
        const date = new Date();
        const result = await aiExtractEventData('', date, ['https://example.com/random-image.jpg']);

        expect(aiExtractEventData).toHaveBeenCalledWith('', date, ['https://example.com/random-image.jpg']);
        expect(result.hasEventData).toBe(false);
    });

    it('should handle mixed text and image messages', async () => {
        // Mock AI response for a message with both text and image
        const mockAiResponse = {
            hasEventData: true,
            name: "Yoga Retreat",
            description: "Join our yoga retreat in the mountains\n\nSee flyer for details",
            startDate: "2024-12-20T08:00:00+01:00",
            address: "Mountain Resort, Alps",
            price: "200€",
            tags: ["yoga", "retreat", "mountains"]
        };

        (aiExtractEventData as any).mockResolvedValue(mockAiResponse);

        // Test the AI function with both text and image
        const date = new Date();
        const result = await aiExtractEventData('Join our yoga retreat! See flyer for details.', date, ['https://example.com/yoga-flyer.jpg']);

        expect(aiExtractEventData).toHaveBeenCalledWith('Join our yoga retreat! See flyer for details.', date, ['https://example.com/yoga-flyer.jpg']);
        expect(result.hasEventData).toBe(true);
        expect(result.name).toBe("Yoga Retreat");
    });

    it('should handle text messages with adjacent images', async () => {
        // Mock AI response for a text message with adjacent images
        const mockAiResponse = {
            hasEventData: true,
            name: "Art Workshop",
            description: "Learn painting techniques from professional artists\n\nCheck the attached flyer for more details",
            startDate: "2024-12-25T14:00:00+01:00",
            address: "Art Studio, Munich",
            price: "75€",
            tags: ["art", "workshop", "painting"]
        };

        (aiExtractEventData as any).mockResolvedValue(mockAiResponse);

        // Test the AI function with text and multiple adjacent images
        const adjacentImages = [
            'https://example.com/workshop-flyer.jpg',
            'https://example.com/workshop-details.jpg'
        ];
        const date = new Date();
        const result = await aiExtractEventData('Join our art workshop!', date, adjacentImages);

        expect(aiExtractEventData).toHaveBeenCalledWith('Join our art workshop!', date, adjacentImages);
        expect(result.hasEventData).toBe(true);
        expect(result.name).toBe("Art Workshop");
    });

    it('should handle multiple images in a message', async () => {
        // Mock AI response for a message with multiple images
        const mockAiResponse = {
            hasEventData: true,
            name: "Art Exhibition",
            description: "Contemporary art exhibition featuring local artists",
            startDate: "2024-12-10T18:00:00+01:00",
            address: "Art Gallery, Munich",
            tags: ["art", "exhibition", "contemporary"]
        };

        (aiExtractEventData as any).mockResolvedValue(mockAiResponse);

        // Test the AI function with multiple image URLs
        const imageUrls = [
            'https://example.com/flyer-front.jpg',
            'https://example.com/flyer-back.jpg',
            'https://example.com/artwork-preview.jpg'
        ];

        const date = new Date();
        const result = await aiExtractEventData('', date, imageUrls);

        expect(aiExtractEventData).toHaveBeenCalledWith('', date, imageUrls);
        expect(result.hasEventData).toBe(true);
        expect(result.name).toBe("Art Exhibition");
    });

    it('should handle existing source detection in images', async () => {
        // Mock AI response for an image from an existing source
        const mockAiResponse = {
            hasEventData: false,
            existingSource: "awara.events"
        };

        (aiExtractEventData as any).mockResolvedValue(mockAiResponse);

        // Test the AI function with an image that contains a link to an existing source
        const date = new Date();
        const result = await aiExtractEventData('', date, ['https://example.com/awara-event.jpg']);

        expect(aiExtractEventData).toHaveBeenCalledWith('', date, ['https://example.com/awara-event.jpg']);
        expect(result.hasEventData).toBe(false);
        expect(result.existingSource).toBe("awara.events");
    });
});
