// Starter content written when the user chooses "Create sample vault".
// All evidence below is fictional placeholder text for demonstration only.

const card = (tag, cite, body) => `#### ${tag}\n**${cite}**\n${body}\n`;

const flow = {
  version: 1,
  sheets: [
    {
      name: 'Case',
      columns: ['1AC', '1NC', '2AC', 'Block', '1AR', '2NR', '2AR'],
      rows: [
        ['Adv 1 – Grid resilience', 'No impact – grid is resilient', 'Extend Smith – attacks rising', '', '', '', ''],
        ['Solvency – fed key', 'States solve', 'Perm do both', '', '', '', ''],
      ],
    },
    {
      name: 'Politics DA',
      columns: ['1NC', '2AC', 'Block', '1AR', '2NR', '2AR'],
      rows: [
        ['Uniqueness – bill passes now', 'Non-unique – bill already dead', '', '', '', ''],
        ['Link – plan costs capital', 'No link – plan is popular', '', '', '', ''],
      ],
    },
  ],
};

const SAMPLE_VAULT = {
  'Welcome.md': `# Welcome to Tagline

An Obsidian-style workspace for **policy debate** prep. Everything is plain markdown on disk.

## Linking
- Link files with [[Double brackets]], e.g. [[1AC - Grid Plan]] or [[DA - Politics]].
- Tag things with #aff, #neg, #da, #cp, #k, #t, #theory.
- Open the **Graph** (Ctrl+G) to see how your files connect.

## Card formatting (Verbatim-style hotkeys)
| Key | Action |
| --- | --- |
| F4 | Pocket (H1) |
| F5 | Hat (H2) |
| F6 | Block (H3) |
| F7 | Tag (H4) |
| F8 | Cite (bold) |
| F9 | Underline \`++text++\` |
| F10 | Emphasis \`**++text++**\` |
| F11 | Highlight \`==text==\` |
| Ctrl+Shift+S | Send card under cursor to speech doc |

In reading view, toggle **Highlighted only** to read just what you'd say in round. The status bar estimates read time at your WPM.

## Other tools
- **Ctrl+P** quick switcher, **Ctrl+Shift+F** search, **Ctrl+E** toggle read/edit
- **Timer** panel: speech times plus aff/neg prep
- **Flows**: create a new \`.flow\` from the sidebar
`,

  'Affirmative/1AC - Grid Plan.md': `# 1AC – Grid Plan
#aff

## Plan
The United States federal government should substantially increase its investment in electric grid cybersecurity.

## Advantage 1 – Grid Resilience
${card('Grid attacks are rising – the status quo can\'t keep up', 'Example 24 – Jane Example, Fictional Energy Institute, "Placeholder Grid Study", 2024',
    'This is example text. ++Attacks on the grid have increased++ substantially, and ==utilities lack the resources== to ++defend against sophisticated actors++ without ==federal investment==.')}
${card('Federal action is key', 'Sample 23 – John Sample, Imaginary Policy Review, 2023',
      'Placeholder evidence. ==Only the federal government== can ++coordinate the thousands of utilities++ that ==make up the grid.==')}

See also: [[AT - States CP]], [[DA - Politics]]
`,

  'Negative/DA - Politics.md': `# DA – Politics
#neg #da

## 1NC Shell
${card('Uniqueness – the bill passes now', 'Hypothetical 24 – Fake Reporter, Pretend News, 2024',
    'Example text. ++Leadership is confident++ the ==bill will pass== this session.')}
${card('Link – the plan drains political capital', 'Invented 24 – Some Analyst, Mock Journal, 2024',
      'Example text. ==Fights over grid spending== would ++consume the capital++ needed ==for the bill.==')}

Answers: [[AT - Politics]] (not written yet – click to create it)
`,

  'Negative/CP - States.md': `# CP – States
#neg #cp

## Text
The fifty states and all relevant territories should substantially increase their investment in electric grid cybersecurity.

${card('States solve', 'Model 22 – A. Model, Example Federalism Quarterly, 2022',
    'Example text. ==States have successfully== ++led on grid security++ in the past.')}

Answered by: [[AT - States CP]]
`,

  'Negative/K - Capitalism.md': `# K – Capitalism
#neg #k

## Link
${card('Securitizing infrastructure entrenches capital', 'Theorist 20 – P. Theorist, Example Critical Review, 2020',
    'Example text. ++Framing the grid as a security problem++ ==reinforces market logics.==')}

## Alternative
Reject the 1AC in favor of a historical-materialist analysis.
`,

  'Negative/T - Substantial.md': `# T – Substantial
#neg #t

## Interpretation
"Substantial" means at least a 10% increase.

## Violation
The plan increases investment by less than 10%.

## Standards
- Limits
- Ground

## Voters
Fairness and education.
`,

  'Blocks/AT - States CP.md': `# AT – States CP
#aff #blocks

## 2AC
1. **Perm – do both**
2. **Uniformity deficit** – see [[1AC - Grid Plan]]
3. **50-state fiat is a voting issue** #theory

${card('States can\'t coordinate', 'Example 21 – Q. Example, Sample Law Review, 2021',
    'Example text. ++State efforts are fragmented++ and ==leave gaps attackers exploit.==')}
`,

  'Templates/Card.md': `#### Tag
**Author YY** – Credentials, "Title," Publication, Date, URL
Evidence text. ++Underline the warrant++ and ==highlight what you read==.
`,

  'Templates/DA Shell.md': `# DA – Name
#neg #da

## Uniqueness

## Link

## Internal Link

## Impact
`,

  'Templates/CP Shell.md': `# CP – Name
#neg #cp

## Text

## Solvency

## Net Benefit
`,

  'Templates/K Shell.md': `# K – Name
#neg #k

## Link

## Impact

## Alternative

## Framework
`,

  'Templates/Round Notes.md': `# Round – Tournament, Round #
#round

- **Side:** Aff / Neg
- **Opponent:** [[Opponent Name]]
- **Judge:**
- **Decision:**

## 1AC / 1NC

## RFD notes
`,

  'Speech Docs/Speech.md': `# Speech Document

`,

  'Opponents/Example HS AB.md': `# Example HS AB
#opponent

## Aff
Runs a [[1AC - Grid Plan]]-style grid security aff.

## Neg
Usually goes for [[CP - States]] + [[DA - Politics]].
`,

  'Flows/Round 1.flow': JSON.stringify(flow, null, 2),
};

module.exports = { SAMPLE_VAULT };
