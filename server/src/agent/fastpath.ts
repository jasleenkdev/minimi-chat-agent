const WORDS = [
  'hi', 'hii+', 'hello', 'hey', 'heya', 'yo', 'sup', 'thanks', 'thank you', 'thx', 'ty', 'ok', 'okay', 'k', 'cool', 'great', 'nice',
  'awesome', 'perfect', 'got it', 'sounds good', 'bye', 'goodbye', 'see you', 'good (?:morning|afternoon|evening|night)', 'lol',
  'haha', 'yes', 'no', 'yep', 'nope', 'sure', 'there', 'so much', 'a lot', 'again', 'man', 'mate', 'buddy', 'minimi',
];

const TRIVIAL = new RegExp(`^(?:${WORDS.join('|')})(?:[\\s,!.]+(?:${WORDS.join('|')}))*[\\s!.,:)]*$`, 'i');

/** Greetings and acknowledgements skip planning, recall and search entirely. */
export function isTrivial(message: string): boolean {
  const text = message.trim();
  if (!text) return true;
  if (/^[\p{Extended_Pictographic}\p{P}\s]+$/u.test(text)) return true;
  return TRIVIAL.test(text);
}
