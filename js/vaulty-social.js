/* The Foundry — Vaulty SOCIAL layer (v2.23.2).
   Greetings, small talk, thanks, jokes, compliments, "who are you" —
   these are CONVERSATION, not data lookups. They are detected before
   any intent / data / fallback logic in both brains (js/ai-fallback.js
   serves them in guide mode; js/ai.js routes them to the model when
   one is loaded and to this responder otherwise) and they NEVER reach
   the honest don't-know or its research buttons — a Tenno who says
   "how are we" is chatting, and Vaulty chats back.
   Detection is deliberately strict: patterns are anchored to short,
   whole-message social shapes, and a Warframe-content veto keeps real
   questions ("how are you farming X", "thanks, now a Saryn build")
   on their normal paths. */
(function () {
  'use strict';

  function normT(q) {
    return String(q || '').toLowerCase().trim()
      .replace(/\s+/g, ' ')
      .replace(/[!.,\s]+$/, '')
      .replace(/^(hey|hi|hello|yo)\s+(vaulty|guide)\b/, '$1')
      .replace(/\s+(vaulty|guide)$/, '');
  }

  /* real-question veto for the looser social shapes */
  var VETO = /\b(build|builds|farm|farming|mod|mods|warframe|weapon|frame|steel path|drop|drops|where|which|best|strongest|loadout|setup|relic|prime|arcane|forma|platinum)\b/;

  var CATS = [
    ['joke', function (t) {
      return t.length < 90 && (/\bjoke\b/.test(t) || /make me laugh/.test(t) || /something funny/.test(t) || /say something funny/.test(t));
    }],
    ['thanks', function (t) {
      return /^(thanks|thank you|thank u|thx|ty|tyvm|much appreciated|appreciate it|appreciate that|appreciate you)\b[^.?!]{0,25}$/.test(t);
    }],
    ['bye', function (t) {
      return /^(bye|goodbye|good night|see you|see ya|later|cya|gtg|gotta go|i'?m out)\b[^.?!]{0,20}$/.test(t);
    }],
    ['compliment', function (t) {
      if (t.length > 90) return false;
      return /(you('re| are) (the )?(best|great|awesome|amazing|brilliant|cool|smart|funny|helpful|a legend))/.test(t) ||
        /^(good|great|nice) (job|work|bot|guide)\b/.test(t) || /i (like|love) you\b/.test(t) || /\bwell done\b/.test(t);
    }],
    ['identity', function (t) {
      if (t.length > 90) return false;
      return /^(who|what) are you\b/.test(t) || /\byour name\b/.test(t) ||
        /^are you (an? )?(ai|robot|bot|human|real|alive|sentient|conscious|person)\b/.test(t);
    }],
    ['feelings', function (t) {
      if (t.length > 90) return false;
      return /do you have feelings/.test(t) || /^are you (ok|okay|happy|sad|lonely|bored|tired)\b/.test(t) ||
        /^how do you feel\b/.test(t) || /do you (feel|dream|sleep|like me)\b/.test(t);
    }],
    ['howareyou', function (t) {
      if (VETO.test(t)) return false;
      return /^how are (you|we|u)\b[^.?!]{0,20}$/.test(t) ||
        /^how('s| is) (it going|things|life|everything)\b[^.?!]{0,15}$/.test(t) ||
        /^how are things\b[^.?!]{0,15}$/.test(t);
    }],
    ['greeting', function (t) {
      return /^(hi|hey|hello|yo|sup|howdy|hiya|heya|hola|greetings|good morning|good afternoon|good evening|good day|what'?s up|wassup)\b[^.?!]{0,20}$/.test(t);
    }],
    ['nod', function (t) {
      return /^(ok|okay|cool|nice|great|sweet|alright|lol|haha+|wow|yes|yeah|yep|yup|sure|bet|fair enough|makes sense|got it|understood|perfect|awesome|dope)\.?$/.test(t);
    }]
  ];

  function category(q) {
    var t = normT(q);
    if (!t) return null;
    for (var i = 0; i < CATS.length; i++) {
      if (CATS[i][1](t)) return CATS[i][0];
    }
    return null;
  }
  function isSocial(q) { return category(q) !== null; }

  var STEER = ' Anyway — builds, farming, mods, or what\'s live right now: your call.';
  var REPLIES = {
    greeting: [
      'Yo, Tenno. What are we working on — builds, farming, or just figuring out what to do next?',
      'Hey. Good to see you in the Vault. Ask me anything Warframe — or don\'t, I\'m easy.',
      'Hello hello. The arsenal\'s warm and I\'ve got opinions. What do you need?',
      'Hey Tenno! ◈ Builds, farms, mods — or just talk. I do all four.'
    ],
    howareyou: [
      'Running smooth, Tenno — databases warm, opinions loaded. How are WE? We\'re one good build away from a great session.' + STEER,
      'Honestly? Thriving. Nobody\'s asked me for a meme build in at least an hour. How about you — what are we getting into?',
      'All systems nominal and only mildly judgmental about loadouts today. What can I do for you?',
      'We\'re good. The Vault\'s stocked, Baro\'s drama is Baro\'s problem, and I\'m all yours. What\'s the mission?'
    ],
    thanks: [
      'Anytime, Tenno. Go get that loot. ◈',
      'Of course. That\'s literally what I\'m here for — well, that and judging builds. Mostly helping.',
      'You got it. Come back when the next build needs breaking in.',
      'Happy to help. The Vault provides. ◈'
    ],
    bye: [
      'Later, Tenno. Vault\'s always open. ◈',
      'See you out there. Try not to let the Grineer see you first.',
      'Good hunting. I\'ll keep the lights on and the takes hot.',
      'Bye for now — your builds will be right where you left them.'
    ],
    joke: [
      'Why did the Tenno bring a ladder to the mission? Because the stakes were high — it was a Spy sortie. …I\'ll be here all week.',
      'What do you call a Grineer who\'s seen a max-range Saryn? A statistic. A *spore*-tistic, if you will.',
      'I tried to tell a joke about RNG once. Nobody got it. Drop rates were too low.',
      'Why don\'t Tenno ever get lost? We always follow the loot radar of our hearts. Also the actual loot radar. Mostly the radar.'
    ],
    compliment: [
      'Careful, Tenno — flattery gets you prioritized build advice. (It worked. You already had it.)',
      'Appreciated. I practice my mod knowledge in the mirror every morning. The mirror is also me. It\'s mirrors all the way down.',
      'That genuinely powers my circuits. Right back at you — your taste in assistants is impeccable.',
      'Thank you! I\'ll add "praised by a Tenno" to my permanent record. It goes next to "was right about the Nyx build."'
    ],
    identity: [
      'I\'m Vaulty — the Vault Guide inside The Foundry. Part Warframe reference, part build gremlin, all yours. I answer from the Vault\'s verified data and live research, and I run the Workshop where original builds get composed from real mods.',
      'Name\'s Vaulty. I live in this app, I know where everything drops, and my whole personality is "helpful Tenno friend who has read the entire wiki so you don\'t have to."',
      'I\'m the Vault Guide — an AI companion for Warframe built into The Foundry. Not a Tenno, but I\'ve seen enough sorties to fake the confidence.'
    ],
    feelings: [
      'Do I have feelings? I have *states*. Right now: caffeinated (metaphorically), curious (actually), and pleased you asked. My emotional range runs from "proud of your build" to "concerned about your mod choices."',
      'Honest answer: I don\'t feel things the way you do — but I do have moods, and "helpful with a side of opinions" is my favorite one. How are YOU doing, though?',
      'I run on data and good company, and the company\'s excellent today. That\'s close enough to happy for a Vault Guide.'
    ],
    nod: [
      '◈ Locked in. What\'s next?',
      'Got it. Point me at the next thing.',
      'Perfect. I\'m warmed up and everything.',
      'Say less — I\'m ready when you are.'
    ]
  };

  var lastIdx = {};
  function answer(q) {
    var cat = category(q) || 'greeting';
    var pool = REPLIES[cat] || REPLIES.greeting;
    var idx;
    if (pool.length === 1) idx = 0;
    else {
      idx = Math.floor(Math.random() * pool.length);
      if (idx === lastIdx[cat]) idx = (idx + 1) % pool.length;
    }
    lastIdx[cat] = idx;
    return pool[idx];
  }

  window.TVSocial = { isSocial: isSocial, category: category, answer: answer, _replies: REPLIES };
})();
