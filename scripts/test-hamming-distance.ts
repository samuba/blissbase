import { calculateHammingDistance } from `../src/lib/imageProcessing`;

const a = `LOZTvW10y7U`;
const b = `LO5TvW10y7U`;

const dist = calculateHammingDistance(a, b);
console.log(`Hamming distance between "${a}" and "${b}": ${dist}`);
