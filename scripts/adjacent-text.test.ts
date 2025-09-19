import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aiExtractEventData } from "../blissbase-telegram-entry/src/ai";

// Mock the AI function to test the logic
vi.mock("../blissbase-telegram-entry/src/ai", () => ({
    aiExtractEventData: vi.fn()
}));

describe('Adjacent Text Message Processing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should handle text messages with adjacent text details', async () => {
        // Mock AI response for a message with adjacent text details
        const mockAiResponse = {
            hasEventData: true,
            name: "Yoga Workshop",
            description: "Join our yoga workshop\n\nDate: 20.12.2024\nTime: 18:00\nLocation: Yoga Studio\n\nAdditional details in follow-up messages",
            startDate: "2024-12-20T18:00:00+01:00",
            address: "Yoga Studio, Munich",
            price: "45€",
            tags: ["yoga", "workshop", "wellness"]
        };

        (aiExtractEventData as any).mockResolvedValue(mockAiResponse);

        // Test the AI function with combined text from multiple messages
        const mainText = "Join our yoga workshop!";
        const adjacentTexts = [
            "Date: 20.12.2024",
            "Time: 18:00",
            "Location: Yoga Studio",
            "Price: 45€"
        ];
        const combinedText = [mainText, ...adjacentTexts].join('\n\n');

        const date = new Date();
        const result = await aiExtractEventData(combinedText, date, []);

        expect(aiExtractEventData).toHaveBeenCalledWith(combinedText, date, []);
        expect(result.hasEventData).toBe(true);
        expect(result.name).toBe("Yoga Workshop");
        expect(result.startDate).toBe("2024-12-20T18:00:00+01:00");
    });

    it('should handle image messages with adjacent text details', async () => {
        // Mock AI response for an image with adjacent text details
        const mockAiResponse = {
            hasEventData: true,
            name: "Art Exhibition",
            description: "Contemporary art exhibition\n\nSee flyer for details\n\nOpening hours: 10:00-18:00\nFree entry",
            startDate: "2024-12-15T10:00:00+01:00",
            address: "Art Gallery, Berlin",
            tags: ["art", "exhibition", "contemporary"]
        };

        (aiExtractEventData as any).mockResolvedValue(mockAiResponse);

        // Test the AI function with image and adjacent text
        const adjacentTexts = [
            "Opening hours: 10:00-18:00",
            "Free entry",
            "Contemporary art exhibition"
        ];
        const combinedText = adjacentTexts.join('\n\n');
        const imageUrl = 'https://example.com/art-flyer.jpg';

        const date = new Date();
        const result = await aiExtractEventData(combinedText, date, [imageUrl]);

        expect(aiExtractEventData).toHaveBeenCalledWith(combinedText, date, [imageUrl]);
        expect(result.hasEventData).toBe(true);
        expect(result.name).toBe("Art Exhibition");
    });

    it('should handle messages with no adjacent text', async () => {
        // Mock AI response for a standalone message
        const mockAiResponse = {
            hasEventData: true,
            name: "Dance Class",
            description: "Join our dance class every Tuesday",
            startDate: "2024-12-17T19:00:00+01:00",
            address: "Dance Studio, Hamburg",
            price: "25€"
        };

        (aiExtractEventData as any).mockResolvedValue(mockAiResponse);

        // Test the AI function with just the main message
        const mainText = "Join our dance class every Tuesday at 19:00";
        const date = new Date();
        const result = await aiExtractEventData(mainText, date, []);

        expect(aiExtractEventData).toHaveBeenCalledWith(mainText, date, []);
        expect(result.hasEventData).toBe(true);
        expect(result.name).toBe("Dance Class");
    });

    it('should handle adjacent text with formatting preserved', async () => {
        // Mock AI response for messages with formatting
        const mockAiResponse = {
            hasEventData: true,
            name: "Meditation Retreat",
            description: "**Meditation Retreat**\n\n*Date:* 25.12.2024\n*Time:* 09:00\n*Location:* Mountain Resort\n\n*Additional Info:*\n- Bring comfortable clothes\n- Vegetarian meals provided",
            startDate: "2024-12-25T09:00:00+01:00",
            address: "Mountain Resort, Alps",
            price: "150€"
        };

        (aiExtractEventData as any).mockResolvedValue(mockAiResponse);

        // Test with formatted adjacent text
        const mainText = "**Meditation Retreat**";
        const adjacentTexts = [
            "*Date:* 25.12.2024",
            "*Time:* 09:00",
            "*Location:* Mountain Resort",
            "*Additional Info:*\n- Bring comfortable clothes\n- Vegetarian meals provided"
        ];
        const combinedText = [mainText, ...adjacentTexts].join('\n\n');

        const date = new Date();
        const result = await aiExtractEventData(combinedText, date, []);

        expect(aiExtractEventData).toHaveBeenCalledWith(combinedText, date, []);
        expect(result.hasEventData).toBe(true);
        expect(result.name).toBe("Meditation Retreat");
    });

    it('should handle mixed content with both text and images', async () => {
        // Mock AI response for mixed content
        const mockAiResponse = {
            hasEventData: true,
            name: "Cooking Workshop",
            description: "Learn to cook authentic Italian dishes\n\nSee attached flyer for menu details\n\nDuration: 3 hours\nMax participants: 12",
            startDate: "2024-12-22T14:00:00+01:00",
            address: "Cooking School, Frankfurt",
            price: "80€"
        };

        (aiExtractEventData as any).mockResolvedValue(mockAiResponse);

        // Test with main text, adjacent text, and images
        const mainText = "Learn to cook authentic Italian dishes!";
        const adjacentTexts = [
            "Duration: 3 hours",
            "Max participants: 12"
        ];
        const combinedText = [mainText, ...adjacentTexts].join('\n\n');
        const imageUrls = [
            'https://example.com/cooking-flyer.jpg',
            'https://example.com/menu-details.jpg'
        ];

        const date = new Date();
        const result = await aiExtractEventData(combinedText, date, imageUrls);

        expect(aiExtractEventData).toHaveBeenCalledWith(combinedText, date, imageUrls);
        expect(result.hasEventData).toBe(true);
        expect(result.name).toBe("Cooking Workshop");
    });
});
