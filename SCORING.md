# Trivia Battle: scoring and match rules

## Match structure
- 2–12 players per room; at least 2 players are required to start.
- Two teams are balanced at match start. Their sizes differ by no more than one player.
- Five rounds, five challenges per round (25 scheduled challenges total).
- Every challenge has a server-enforced 20-second deadline. The timer continues while a player is disconnected.
- The challenge sequence mixes individual trivia, word puzzles, and strategy challenges.

## Individual trivia
For a correct answer received before the deadline, let `t` be the number of whole milliseconds remaining divided by 1,000, clamped to [0, 20].

`speedBonus = floor(50 * t / 20)`

`individualTriviaPoints = correct ? 50 + speedBonus : 0`

Thus a correct answer can earn 50–100 points: 100 at the start, 75 with 10 seconds left, and 52 with 1 second left. Incorrect answers, timeouts, and answers received at/after the deadline earn zero. The server calculates remaining time from its own clock; clients cannot submit time or points.

## Collaborative challenges
- Word puzzles and strategy challenges are shared team-answer challenges.
- Each team can submit one answer; the first valid submission locks it for that team.
- Correct answer: +100 shared team points.
- Incorrect answer or no answer before the deadline: +0 points.
- No speed bonus is used for collaborative challenges, allowing discussion time.
- A team answer is not revealed as correct/incorrect to other teams until the challenge closes.

## Team totals
For every individual trivia challenge, the team earns the arithmetic mean of its roster's individual points for that challenge. Every player assigned at match start is included in the denominator; incorrect, unanswered, or disconnected players contribute zero. The average is retained as a decimal internally. Shared challenge points are added directly to the same team total. Individual personal totals are also shown, but the winning team is determined by team total.

## Sudden-death tie-breaker
If the scheduled match ends with equal team totals, only the tied teams enter sudden death. Every tied team receives the same new server-timed trivia challenge. Each player answers individually; correct answers use the same 50-base-plus-up-to-50-speed-bonus formula. Each team's tie-break score is the mean of its roster's points on that challenge. The highest mean wins immediately. If the means remain equal (including all-zero ties), another identical-format challenge is played. Tie-breaker points do not alter the scheduled-match totals; they only determine the winner.

## Fairness and security
- The server owns the deadline, answer validation, team membership, and scoring.
- One individual answer per player per trivia challenge; one team answer per team per collaborative challenge.
- Answers and answer keys are not sent to clients until a challenge closes.
- Disconnecting does not pause the timer or erase scores. A reconnect token restores the same player session while the room remains active.
