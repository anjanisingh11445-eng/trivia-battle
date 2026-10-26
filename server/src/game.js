import crypto from 'node:crypto';

export const CHALLENGE_SECONDS = 20;
export const MAX_PLAYERS = 12;
export const MIN_PLAYERS = 2;
export const COLLABORATIVE_POINTS = 100;

export function normalizeAnswer(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US').normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function triviaPoints(isCorrect, remainingSeconds) {
  if (!isCorrect) return 0;
  const t = Math.max(0, Math.min(CHALLENGE_SECONDS, Number(remainingSeconds) || 0));
  return 50 + Math.floor((50 * t) / CHALLENGE_SECONDS);
}

export function teamAverage(points, rosterSize) {
  if (!rosterSize) return 0;
  return points.reduce((sum, point) => sum + point, 0) / rosterSize;
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

export const CHALLENGES = [
  { type: 'trivia', prompt: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'], answer: 'Mars', explanation: 'Iron-rich dust gives Mars its reddish appearance.' },
  { type: 'word', prompt: 'Unscramble this word: “L P A P E”', options: [], answer: 'APPLE', explanation: 'The letters form APPLE.' },
  { type: 'trivia', prompt: 'How many sides does a hexagon have?', options: ['5', '6', '7', '8'], answer: '6', explanation: 'A hexagon has six sides.' },
  { type: 'strategy', prompt: 'Your team has one shield for a final round. Which is the safest strategy?', options: ['Use it immediately', 'Save it until the highest-risk moment', 'Give it away', 'Ignore the rules'], answer: 'Save it until the highest-risk moment', explanation: 'Saving a limited resource for the highest-risk moment preserves its value.' },
  { type: 'trivia', prompt: 'What is the largest ocean on Earth?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], answer: 'Pacific', explanation: 'The Pacific is the largest ocean.' },
  { type: 'trivia', prompt: 'Which gas do plants absorb from the atmosphere for photosynthesis?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'], answer: 'Carbon dioxide', explanation: 'Plants use carbon dioxide, water, and light to make sugars.' },
  { type: 'word', prompt: 'Unscramble this word: “N I R A B O W”', options: [], answer: 'RAINBOW', explanation: 'The letters form RAINBOW.' },
  { type: 'trivia', prompt: 'What is the capital of Japan?', options: ['Kyoto', 'Seoul', 'Tokyo', 'Osaka'], answer: 'Tokyo', explanation: 'Tokyo is Japan’s capital.' },
  { type: 'strategy', prompt: 'Two clues conflict. What should your team do first?', options: ['Pick the first idea', 'Compare evidence and eliminate contradictions', 'Vote without discussion', 'Skip every clue'], answer: 'Compare evidence and eliminate contradictions', explanation: 'Checking evidence helps the team make a reasoned decision.' },
  { type: 'trivia', prompt: 'Which instrument measures temperature?', options: ['Barometer', 'Thermometer', 'Altimeter', 'Compass'], answer: 'Thermometer', explanation: 'A thermometer measures temperature.' },
  { type: 'trivia', prompt: 'How many minutes are in two hours?', options: ['100', '110', '120', '140'], answer: '120', explanation: 'Two hours equals 120 minutes.' },
  { type: 'word', prompt: 'Unscramble this word: “E N A L P T”', options: [], answer: 'PLANET', explanation: 'The letters form PLANET.' },
  { type: 'trivia', prompt: 'Which animal is a mammal?', options: ['Shark', 'Dolphin', 'Trout', 'Octopus'], answer: 'Dolphin', explanation: 'Dolphins are mammals that breathe air.' },
  { type: 'strategy', prompt: 'Your team has limited time and three leads. What is the best first move?', options: ['Investigate all equally forever', 'Prioritize the lead with strongest evidence', 'Choose randomly', 'Ignore all leads'], answer: 'Prioritize the lead with strongest evidence', explanation: 'Prioritization uses limited time where it is most likely to help.' },
  { type: 'trivia', prompt: 'What is H₂O commonly known as?', options: ['Salt', 'Water', 'Oxygen', 'Hydrogen'], answer: 'Water', explanation: 'H₂O is the chemical formula for water.' },
  { type: 'word', prompt: 'Unscramble this word: “H T R E A”', options: [], answer: 'EARTH', explanation: 'The letters form EARTH.' },
  { type: 'trivia', prompt: 'Which continent is the Sahara Desert in?', options: ['Asia', 'Africa', 'Australia', 'South America'], answer: 'Africa', explanation: 'The Sahara spans much of North Africa.' },
  { type: 'trivia', prompt: 'What is 9 × 7?', options: ['56', '63', '72', '79'], answer: '63', explanation: 'Nine multiplied by seven equals 63.' },
  { type: 'strategy', prompt: 'Your team is split between two answers. What should you do before submitting?', options: ['Submit both answers', 'Quickly compare the strongest supporting clue', 'Wait until time runs out', 'Change answers randomly'], answer: 'Quickly compare the strongest supporting clue', explanation: 'A fast evidence check helps align the team before locking its answer.' },
  { type: 'trivia', prompt: 'Which shape has three sides?', options: ['Square', 'Triangle', 'Pentagon', 'Circle'], answer: 'Triangle', explanation: 'A triangle has three sides.' },
  { type: 'word', prompt: 'Unscramble this word: “H C A I R”', options: [], answer: 'CHAIR', explanation: 'The letters form CHAIR.' },
  { type: 'trivia', prompt: 'Which star is closest to Earth?', options: ['Sirius', 'Polaris', 'The Sun', 'Vega'], answer: 'The Sun', explanation: 'The Sun is our nearest star.' },
  { type: 'trivia', prompt: 'Which language is primarily used to structure web pages?', options: ['HTML', 'SQL', 'Python', 'Bash'], answer: 'HTML', explanation: 'HTML defines the structure and content of web pages.' },
  { type: 'strategy', prompt: 'A plan is not working and time is running out. What is the strongest response?', options: ['Keep repeating it unchanged', 'Review the evidence and adapt quickly', 'Blame a teammate', 'Stop communicating'], answer: 'Review the evidence and adapt quickly', explanation: 'A quick evidence-based adjustment is better than repeating a failed approach.' },
  { type: 'word', prompt: 'Unscramble this word: “T A R S”', options: [], answer: 'STAR', explanation: 'The letters form STAR.' }
];


export function assignTeams(players) {
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  shuffled.forEach((player, index) => { player.teamId = index % 2 === 0 ? 'blue' : 'purple'; });
  return [
    { id: 'blue', name: 'Neon Comets', score: 0 },
    { id: 'purple', name: 'Cyber Phoenixes', score: 0 }
  ];
}

export function buildChallengeDeck() {
  // The supplied curated deck deliberately interleaves all three challenge formats.
  return CHALLENGES.map((challenge, index) => ({ ...challenge, id: `challenge-${index + 1}`, round: Math.floor(index / 5) + 1, index }));
}

export function publicChallenge(challenge) {
  if (!challenge) return null;
  const { answer, explanation, ...safe } = challenge;
  return safe;
}
