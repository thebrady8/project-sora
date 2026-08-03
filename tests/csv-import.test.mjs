import assert from 'node:assert/strict';
import { parseCsvGames, serializeLibraryCsv } from '../public/csv-utils.mjs';

const csvInput = `Title,Platform,Condition,Purchase Price,Current Value,Metacritic Score,Notes
"The Witcher 3","PC","Mint","29.99","49.99","92","Completed"
"Portal 2","PC","Good","9.99","14.99","95","Co-op favorite"`;

const games = parseCsvGames(csvInput);
assert.equal(games.length, 2);
assert.equal(games[0].title, 'The Witcher 3');
assert.equal(games[0].condition, 'Mint');
assert.equal(games[1].purchasePrice, 9.99);

const csvOutput = serializeLibraryCsv(games);
assert.match(csvOutput, /Title,Platform,Condition/);
assert.match(csvOutput, /The Witcher 3/);

console.log('CSV import test passed');
