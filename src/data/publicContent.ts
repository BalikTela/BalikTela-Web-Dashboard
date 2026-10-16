export const pathways = [
  {
    id: 'reuse', label: 'Reuse & barter', title: 'Still useful. Ready for someone new.',
    description: 'Clothing, surplus fabric, and other reusable textiles can stay in circulation when the right people find each other.',
    steps: [
      ['Share what you have', 'Describe the material, its condition, quantity, and location in the mobile app.'],
      ['Find the right connection', 'Explore suitable listings, discuss the exchange, and agree on the terms.'],
      ['Record the next chapter', 'Confirm the handover and keep a traceable transaction history.'],
    ],
  },
  {
    id: 'redistribute', label: 'Donate & redistribute', title: 'A change of hands. A continuing purpose.',
    description: 'Connect suitable materials with participating community organizations and beneficiaries through documented donation and redistribution pathways.',
    steps: [
      ['Identify suitable materials', 'Check the condition and the receiving organization\'s acceptance requirements.'],
      ['Coordinate with a participant', 'Agree on the recipient and collection or handover arrangements.'],
      ['Confirm where it goes', 'Record receipt so the material\'s journey remains visible to authorized users.'],
    ],
  },
  {
    id: 'recover', label: 'Recover & recycle', title: 'Beyond reuse, there is still possibility.',
    description: 'Materials that cannot be reused may be suitable for upcycling or recycling, depending on their composition, condition, and a partner\'s processing capabilities.',
    steps: [
      ['Know the material', 'Identify the textile category and record available weight evidence.'],
      ['Connect with a recovery partner', 'Check accepted materials, location, and the partner\'s requirements.'],
      ['Validate the outcome', 'Keep received, processed, and recovered quantities distinct in the record.'],
    ],
  },
] as const;

export const communities = [
  { title: 'People & communities', description: 'Give unwanted textiles a new purpose through exchange, donation, and community participation.', channel: 'Participate through the mobile app', icon: 'people' },
  { title: 'Producers & retailers', description: 'Connect surplus stock and textile materials with reuse and recovery pathways. Monitor your organization\'s participation.', channel: 'Participate and monitor', icon: 'producer' },
  { title: 'Recyclers & recovery partners', description: 'Identify suitable materials, document recovery activities, and build a clearer picture of material flows.', channel: 'Recover and report', icon: 'recycler' },
  { title: 'Researchers & policymakers', description: 'Use authorized, scoped information to study participation, monitor outcomes, and inform decisions.', channel: 'Explore institutional insights', icon: 'research' },
] as const;

export const publicFaqs = [
  ['What is BalikTelaPH?', 'BalikTelaPH is a National University research initiative developing a connected mobile application and web analytics dashboard for circular textile management in the Philippines. It brings producers, recyclers, and beneficiaries into a shared, traceable textile network.'],
  ['Which platform should I use?', 'Use the mobile application for textile listings, exchanges, communication, and participation. The web dashboard is the institutional workspace for authorized administrators, producers, recyclers, government users, and researchers, with information limited by each account\'s role and scope.'],
  ['How do I open the mobile app?', 'Use the Open the mobile app button to open BalikTelaPH\'s mobile web experience in a new tab. Follow the app\'s sign-in or onboarding process to participate. This website does not claim an Android or iOS app-store release.'],
  ['Can anyone create a dashboard account?', 'No. Dashboard access is provided through an administrator invitation and an approved institutional role. Invited users confirm their email and set their own password. Community participants should use the mobile application rather than request administrative access.'],
  ['What textiles can be exchanged or recovered?', 'Eligibility depends on the material, its condition, and the receiving participant\'s acceptance rules. Clothing, fabric offcuts, and surplus textiles may have different reuse or recovery pathways. Confirm pilot acceptance requirements before arranging a handover; not every textile is recyclable.'],
  ['Are the reported environmental benefits verified?', 'The project distinguishes recorded material quantities from environmental estimates. Carbon, water, and other environmental equivalents require an approved calculation methodology. Development or synthetic dashboard figures are not verified project impact results.'],
] as const;
