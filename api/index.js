const { Telegraf } = require('telegraf');
const { Redis } = require('@upstash/redis');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '9158131062:AAGbryzXffATct4hsOTGdOBTpS9SsFOIpa4');
const redis = new Redis({
  url: process.env.KV_REST_API_URL || '',
  token: process.env.KV_REST_API_TOKEN || '',
});

const ADMIN_ID = process.env.ADMIN_CHAT_ID || '7120292163';

// Helper: Card generation & evaluation for Shan Koe Mee
function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = [
    { label: 'A', val: 1 }, { label: '2', val: 2 }, { label: '3', val: 3 },
    { label: '4', val: 4 }, { label: '5', val: 5 }, { label: '6', val: 6 },
    { label: '7', val: 7 }, { label: '8', val: 8 }, { label: '9', val: 9 },
    { label: '10', val: 10 }, { label: 'J', val: 10 }, { label: 'Q', val: 10 }, { label: 'K', val: 10 }
  ];
  let deck = [];
  suits.forEach(suit => {
    values.forEach(v => {
      deck.push({ ...v, suit, color: (suit === '♥' || suit === '♦') ? 'card-red' : 'card-black' });
    });
  });
  return deck.sort(() => Math.random() - 0.5);
}

function evaluateHand(cards) {
  let sum = cards.reduce((acc, c) => acc + c.val, 0);
  let points = sum % 10;
  let isPaired = cards.length === 2 && cards[0].label === cards[1].label;
  let isThreeOfAKind = cards.length === 3 && cards[0].label === cards[1].label && cards[1].label === cards[2].label;
  let isStraightFlush = false; // Simplified

  let label = `${points} ပွိုင့်`;
  let rank = points;

  if (isPaired) { label = `စကော့ (${cards[0].label} တူ)`; rank = 10 + points; }
  if (isThreeOfAKind) { label = `ဘောင် (${cards[0].label} သုံးလုံး)`; rank = 30; }
  if (points === 9 && cards.length === 2) { label = `ကိုးမီး (9 Points)`; rank = 20; }

  return { points, label, rank };
}

// Telegram Bot Webhook / Commands
bot.start((ctx) => {
  ctx.reply("🎮 Shan Koe Mee Crypto Game သို့ ကြိုဆိုပါတယ်ခင်ဗျာ။ Mini App မှတဆင့် ဆော့ကစားနိုင်ပါပြီ။");
});

// Vercel Serverless Function Handler
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      const { userId, userName, action, currency, bet, amount, txHash, wallet } = req.body;
      if (!userId) return res.status(400).json({ success: false, error: 'Unauthorized User' });

      let userKey = `user:${userId}`;
      let userData = await redis.get(userKey) || { balances: { TON: 10.0, USDT: 50.0 }, activeGame: null, bankerRounds: 0 };

      if (action === 'init') {
        return res.json({ success: true, balances: userData.balances });
      }

      if (action === 'deal') {
        if (!currency || !bet || userData.balances[currency] < bet) {
          return res.json({ success: false, error: 'လက်ကျန်ငွေ မလုံလောက်ပါ' });
        }
        userData.balances[currency] -= bet;

        let deck = createDeck();
        let playerHand = [deck.pop(), deck.pop()];
        let bankerCardCount = 2;

        userData.activeGame = { currency, bet, playerHand, bankerCards: [deck.pop(), deck.pop()], deck, bankerCardCount };
        await redis.set(userKey, userData);

        return res.json({
          success: true,
          playerHand,
          bankerCardCount,
          playerEval: evaluateHand(playerHand),
          balances: userData.balances
        });
      }

      if (action === 'draw') {
        let game = userData.activeGame;
        if (!game) return res.json({ success: false, error: 'လက်ရှိဂိမ်း မရှိပါ။' });

        game.playerHand.push(game.deck.pop());
        let pEval = evaluateHand(game.playerHand);
        let bEval = evaluateHand(game.bankerCards);

        let outcome = 'LOSE', diff = game.bet;
        if (pEval.rank > bEval.rank) { outcome = 'WIN'; diff = game.bet * 0.95; userData.balances[game.currency] += game.bet + diff; }
        else if (pEval.rank === bEval.rank) { outcome = 'DRAW'; userData.balances[game.currency] += game.bet; diff = 0; }
        else { userData.balances[game.currency] -= 0; } // lost

        let resData = {
          success: true,
          finished: true,
          outcome,
          diff,
          currency: game.currency,
          newBalance: userData.balances[game.currency],
          playerHand: game.playerHand,
          bankerHand: game.bankerCards,
          playerEval: pEval,
          bankerEval: bEval
        };
        userData.activeGame = null;
        await redis.set(userKey, userData);
        return res.json(resData);
      }

      if (action === 'show') {
        let game = userData.activeGame;
        if (!game) return res.json({ success: false, error: 'လက်ရှိဂိမ်း မရှိပါ။' });

        let pEval = evaluateHand(game.playerHand);
        let bEval = evaluateHand(game.bankerCards);

        let outcome = 'LOSE', diff = game.bet;
        if (pEval.rank > bEval.rank) { outcome = 'WIN'; diff = game.bet * 0.95; userData.balances[game.currency] += game.bet + diff; }
        else if (pEval.rank === bEval.rank) { outcome = 'DRAW'; userData.balances[game.currency] += game.bet; diff = 0; }

        let resData = {
          success: true,
          finished: true,
          outcome,
          diff,
          currency: game.currency,
          newBalance: userData.balances[game.currency],
          playerHand: game.playerHand,
          bankerHand: game.bankerCards,
          playerEval: pEval,
          bankerEval: bEval
        };
        userData.activeGame = null;
        await redis.set(userKey, userData);
        return res.json(resData);
      }

      if (action === 'deposit') {
        if (!amount || amount < 1.0) return res.json({ success: false, error: 'အနည်းဆုံး ငွေသွင်းရန်မှာ 1.0 ဖြစ်ပါသည်။' });
        userData.balances[currency] += parseFloat(amount);
        await redis.set(userKey, userData);
        return res.json({ success: true, message: `ငွေသွင်းမှု ${amount} ${currency} အောင်မြင်ပါသည်။` });
      }

      if (action === 'withdraw') {
        if (!amount || amount < 3.0) return res.json({ success: false, error: 'အနည်းဆုံး ငွေထုတ်ရန်မှာ 3.0 ဖြစ်ပါသည်။' });
        let totalDeduct = parseFloat(amount) + 0.05; // Fee 0.05
        if (userData.balances[currency] < totalDeduct) return res.json({ success: false, error: 'ငွေထုတ်ခ (Fee 0.05) အပါအဝင် လက်ကျန်ငွေ မလုံလောက်ပါ။' });

        userData.balances[currency] -= totalDeduct;
        await redis.set(userKey, userData);
        return res.json({ success: true, newBalance: userData.balances[currency], message: `ငွေထုတ်ယူမှု တောင်းဆိုချက် ပေးပို့ပြီးပါပြီ။` });
      }

      return res.status(400).json({ success: false, error: 'Invalid action' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  } else {
    return res.status(200).json({ status: 'Bot Server is running fine!' });
  }
};
