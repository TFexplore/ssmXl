const generateMockMappings = (count) => {
    const mappings = [];
    for (let i = 1; i <= count; i++) {
        const comPort = `COM${i}`;
        // Generate a realistic-looking phone number
        const phoneNumber = `13${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`;
        mappings.push(`${comPort} ${phoneNumber}`);
    }
    return mappings;
};

const mockData = generateMockMappings(50); // Generate 25 mock mappings
console.log(mockData.join('\n'));
