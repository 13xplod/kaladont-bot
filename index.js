// Discord bot implementing a multiplayer Kaladont game in Serbian.
// Features channel-based games, turn order, word chaining, proper noun blocking, and dictionary validation.
require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, Events, EmbedBuilder, ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID;
if (!token) {
  console.error('Missing DISCORD_TOKEN');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const BOT_VERSION = '0.2.0-beta';
// Timers (ms)
const LOBBY_DURATION_MS = 2 * 60 * 1000; // 2 minutes to join
const TURN_DURATION_MS = 30 * 1000; // 30 seconds per turn
const GAME_DURATION_MS = 10 * 60 * 1000; // 10 minute match

function minutes(ms) {
  return Math.round(ms / 60000);
}
const games = new Map();
const serbianDictionary = require('./serbianDictionary');
const bannedWords = require('./bannedWords');

function isValidWord(word) {
  return /^[a-zčćđšž]+$/i.test(word);
}

function isDictionaryWord(word) {
  return serbianDictionary.has(word.toLowerCase());
}

function isBannedWord(word) {
  return bannedWords.has(word.toLowerCase());
}

function isAdmin(userId) {
  return ADMIN_USER_ID && String(userId) === String(ADMIN_USER_ID);
}

function saveDictionary() {
  const words = [...serbianDictionary].sort((a, b) => a.localeCompare(b, 'sr'));
  const output = ['module.exports = new Set(['];
  for (const word of words) {
    output.push(`  "${word}",`);
  }
  if (output.length > 1) {
    output[output.length - 1] = output[output.length - 1].replace(/,$/, '');
  }
  output.push(']);');
  fs.writeFileSync('./serbianDictionary.js', output.join('\n') + '\n', 'utf8');
}

function getGame(channelId) {
  return games.get(channelId);
}

function deleteLater(item, delay = 8000) {
  setTimeout(async () => {
    try {
      if (item?.delete) await item.delete();
    } catch {}
  }, delay);
}

function makeEmbed({ title, description, color = 0x2ecc71, fields = [], footer, timestamp = false }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setDescription(description || '');

  if (title) embed.setTitle(title);
  if (fields.length) embed.addFields(fields);
  if (footer) embed.setFooter({ text: footer });
  if (timestamp) embed.setTimestamp();
  return embed;
}

function sendEmbed(channel, options) {
  return channel.send({ embeds: [makeEmbed(options)] });
}

function replyEmbed(message, options) {
  return message.reply({ embeds: [makeEmbed(options)] });
}

function sendTempReply(message, text, delay = 8000) {
  return replyEmbed(message, {
    title: 'Greška',
    description: text,
    color: 0xe74c3c,
  }).then((reply) => {
    deleteLater(message, delay);
    deleteLater(reply, delay);
    return reply;
  });
}

function createGame(channel, starterId) {
  const game = {
    players: [starterId],
    turnIndex: 0,
    currentPlayerIndex: 0,
    scores: new Map([[starterId, 0]]),
    lastWord: null,
    requiredPrefix: null,
    usedWords: new Set(),
    joiningOpen: true,
    joinTimeout: null,
    gameTimeout: null,
    turnTimeout: null,
    startTimestamp: null,
    eliminatedPlayers: [],
    lobbyMessage: null,
    state: 'lobby',
  };
  games.set(channel.id, game);
  game.joinTimeout = setTimeout(() => startGame(channel), LOBBY_DURATION_MS);
  return game;
}

function clearTurnTimer(game) {
  if (game?.turnTimeout) {
    clearTimeout(game.turnTimeout);
    game.turnTimeout = null;
  }
}

async function disableLobbyButton(game) {
  if (!game?.lobbyMessage) return;

  const disabledButton = new ButtonBuilder()
    .setCustomId('kaladont-join')
    .setLabel('Pridruživanje zatvoreno')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const disabledRow = new ActionRowBuilder().addComponents(disabledButton);

  try {
    await game.lobbyMessage.edit({ components: [disabledRow] });
  } catch (error) {
    console.error('Failed to disable lobby button:', error);
  }
}

function clearTimeInterval(game) {
  if (game?.timeInterval) {
    clearInterval(game.timeInterval);
    game.timeInterval = null;
  }
}

function scheduleTimeAnnouncements(channel, game) {
  clearTimeInterval(game);
  if (!game || game.state !== 'playing') return;

  game.timeInterval = setInterval(() => {
    const remaining = game.startTimestamp + GAME_DURATION_MS - Date.now();
    if (remaining <= 0) {
      clearTimeInterval(game);
      return;
    }
    const secs = Math.ceil(remaining / 1000);
    // Announce every full minute, and every 10s during the last 30 seconds
    if (secs % 60 === 0 || (secs <= 30 && secs % 10 === 0)) {
      const minutesLeft = Math.floor(secs / 60);
      const secondsLeft = secs % 60;
      sendEmbed(channel, {
        title: 'Preostalo vreme',
        description: `⏳ Preostalo vreme: ${minutesLeft}m ${secondsLeft}s`,
        color: 0x3498db,
      });
    }
  }, 1000);
}

function getCurrentPlayer(game) {
  if (!game?.players?.length) return null;
  return game.players[game.currentPlayerIndex % game.players.length];
}

function scheduleTurnTimeout(channel, game) {
  clearTurnTimer(game);
  if (!game || game.state !== 'playing') return;

  const currentPlayer = getCurrentPlayer(game);
  if (!currentPlayer || game.players.length < 2) return;

  game.turnTimeout = setTimeout(() => {
    game.turnTimeout = null;
    const activePlayer = getCurrentPlayer(game);
    if (game.state !== 'playing' || activePlayer !== currentPlayer) return;
    eliminatePlayer(channel, game, currentPlayer, 'timeout', 'nije odgovorio/la na vreme').catch((error) => {
      console.error('Turn timeout handling failed:', error);
    });
  }, TURN_DURATION_MS);
}

async function eliminatePlayer(channel, game, playerId, reason, detailText) {
  if (!game || game.state !== 'playing') return false;

  clearTurnTimer(game);
  const playerIndex = game.players.indexOf(playerId);
  if (playerIndex === -1) return false;

  game.players.splice(playerIndex, 1);
  game.scores.delete(playerId);
  game.eliminatedPlayers.push({ playerId, reason, detailText });
  clearTimeInterval(game);

  if (playerIndex < game.currentPlayerIndex) {
    game.currentPlayerIndex -= 1;
  } else if (playerIndex === game.currentPlayerIndex) {
    game.currentPlayerIndex = playerIndex % game.players.length;
  }

  if (game.players.length === 1) {
    const winner = game.players[0];
    // clear timers and intervals before finishing the game
    if (game.joinTimeout) {
      clearTimeout(game.joinTimeout);
      game.joinTimeout = null;
    }
    if (game.gameTimeout) {
      clearTimeout(game.gameTimeout);
      game.gameTimeout = null;
    }
    clearTimeInterval(game);
    await disableLobbyButton(game);
    games.delete(channel.id);
    await sendEmbed(channel, {
      title: 'Kraj igre',
      description: `🏁 ${mention(winner)} je poslednji preostali igrač/ica i pobednik/pobednica! ${reason === 'timeout' ? 'Nije odgovorio/la na vreme.' : 'Izgubio/la je.'}`,
      color: 0x2ecc71,
    });
    return true;
  }

  if (game.players.length === 0) {
    if (game.joinTimeout) {
      clearTimeout(game.joinTimeout);
      game.joinTimeout = null;
    }
    if (game.gameTimeout) {
      clearTimeout(game.gameTimeout);
      game.gameTimeout = null;
    }
    clearTimeInterval(game);
    await disableLobbyButton(game);
    games.delete(channel.id);
    await sendEmbed(channel, {
      title: 'Kraj igre',
      description: '🏁 Nema više igrača. Igra je završena.',
      color: 0x95a5a6,
    });
    return true;
  }

  const remainingPlayers = game.players.map(mention).join(', ');
  const nextPlayer = getCurrentPlayer(game);
  await sendEmbed(channel, {
    title: 'Igrač eliminisan',
    description: `❌ ${mention(playerId)} je eliminisan/a jer ${detailText}. Preostali igrači: ${remainingPlayers}.\n\nSledeći na redu je: ${nextPlayer ? mention(nextPlayer) : 'nema više igrača'}`,
    color: 0xe74c3c,
  });

  scheduleTurnTimeout(channel, game);
  return false;
}

async function startGame(channel) {
  const game = getGame(channel.id);
  if (!game) return;
  game.joiningOpen = false;
  await disableLobbyButton(game);

  if (game.players.length < 2) {
    await disableLobbyButton(game);
    games.delete(channel.id);
    await sendEmbed(channel, {
      title: 'Igra otkazana',
      description: '❌ Igra je otkazana jer se nije pridružilo barem 2 igrača.',
      color: 0xe74c3c,
    });
    return;
  }

  game.state = 'playing';
  game.startTimestamp = Date.now();
  game.gameTimeout = setTimeout(() => endGame(channel), GAME_DURATION_MS);
  game.currentPlayerIndex = 0;
  scheduleTurnTimeout(channel, game);
  scheduleTimeAnnouncements(channel, game);
  await sendEmbed(channel, {
    title: 'Igra počinje',
    description: `🟢 Igra počinje! \n Trenutni igrači: ${game.players.map(mention).join(', ')}. \n ${mention(getCurrentPlayer(game))} je prvi.\n Igra traje ${minutes(GAME_DURATION_MS)} minuta.`,
    color: 0x2ecc71,
  });
}

async function endGame(channel) {
  const game = getGame(channel.id);
  if (!game) return;
  if (game.joinTimeout) {
    clearTimeout(game.joinTimeout);
  }
  if (game.gameTimeout) {
    clearTimeout(game.gameTimeout);
  }
  clearTurnTimer(game);
  clearTimeInterval(game);

  const results = [...game.scores.entries()];
  results.sort((a, b) => b[1] - a[1]);
  const highestPoints = results.length ? results[0][1] : 0;
  const winners = results.filter(([, points]) => points === highestPoints).map(([id]) => id);
  const dnfPlayers = (game.eliminatedPlayers || []).map(({ playerId }) => mention(playerId));

  games.delete(channel.id);
  await sendEmbed(channel, {
    title: 'Kraj igre',
    description: `⏰ Vreme je isteklo! ${winners.length ? `Pobednik/pobednici: ${winners.map(mention).join(', ')} sa ${highestPoints} bodova.` : 'Nema preživelih igrača.'}${dnfPlayers.length ? `\nDNF: ${dnfPlayers.join(', ')}` : ''}`,
    color: 0x3498db,
  });
}

function getRequiredPrefix(word) {
  const normalized = word.toLowerCase();
  const digraphs = new Set(['nj', 'lj', 'dž']);
  const letters = [];
  let i = normalized.length - 1;

  while (letters.length < 2 && i >= 0) {
    if (i > 0) {
      const pair = normalized[i - 1] + normalized[i];
      if (digraphs.has(pair)) {
        letters.unshift(pair);
        i -= 2;
        continue;
      }
    }
    letters.unshift(normalized[i]);
    i -= 1;
  }

  return letters.join('');
}

function mention(userId) {
  return `<@${userId}>`;
}

function channelContainsKaladont(channel) {
  const channelName = channel?.name ? String(channel.name).toLowerCase() : '';
  const channelTopic = channel?.topic ? String(channel.topic).toLowerCase() : '';
  return channelName.includes('kaladont') || channelTopic.includes('kaladont');
}

function computeScore(word) {
  const len = word.length;
  const uniqueLetters = new Set(word).size;
  const rareLetters = (word.match(/[qxzw]/gi) || []).length;
  const lengthScore = Math.min(70, Math.max(0, (len - 3) * 8));
  const varietyScore = Math.min(20, uniqueLetters * 2);
  const rareScore = Math.min(20, rareLetters * 10);
  const score = Math.max(1, Math.min(100, Math.round(lengthScore + varietyScore + rareScore)));
  return score;
}

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() || interaction.customId !== 'kaladont-join') return;

  const channel = interaction.channel;
  const authorId = interaction.user.id;
  const game = getGame(channel?.id);

  if (!channel || !game) {
    return interaction.reply({ content: 'Nema aktivne igre u ovom kanalu.', ephemeral: true });
  }

  if (game.state !== 'lobby') {
    return interaction.reply({ content: 'Pridruživanje je zatvoreno, igra je već počela.', ephemeral: true });
  }

  if (game.players.includes(authorId)) {
    return interaction.reply({ content: 'Već si u igri. Sačekaj svoj red.', ephemeral: true });
  }

  game.players.push(authorId);
  game.scores.set(authorId, 0);

  return interaction.reply({
    embeds: [makeEmbed({
      title: 'Igrač pridružen',
      description: `${mention(authorId)} se pridružio/la igri.\n Morate sačekati da igra počne.\n Trenutno je na redu ${mention(getCurrentPlayer(game))}.`,
      color: 0x3498db,
    })],
  });
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const raw = message.content.trim();
  if (!raw) return;

  const content = raw.toLowerCase();
  const authorId = message.author.id;
  const channel = message.channel;
  const channelId = channel.id;
  const game = getGame(channelId);

  if (content === 'sok za decu') {
    if (message.member?.timeout) {
      try {
        await message.member.timeout(18 * 100000, 'Pisanje "Sok za decu"');
        return replyEmbed(message, {
          title: 'Timeout Easter Egg',
          description: 'Zbog poruke "Sok za decu" dobio/la si timeout na 30 minuta. (Easter Egg)',
          color: 0xe74c3c,
        });
      } catch (error) {
        console.error('Timeout failed:', error);
        return replyEmbed(message, {
          title: 'Timeout Easter Egg',
          description: 'Pokušao sam da te timeoutujem na 30 minuta, ali nije uspelo.\n\n Verovatno osoba koja je poslala poruku ima viši rang od bota ili bot nema dozvolu da timeoutuje članove.',
          color: 0xe74c3c,
        });
      }
    }

    return replyEmbed(message, {
      title: 'Timeout Easter Egg',
      description: 'Ne mogu da te timeoutujem jer nemam pristup članu.',
      color: 0xe74c3c,
    });
  }

  if (content === '!start') {
    if (!channelContainsKaladont(message.channel)) {
      return sendTempReply(
        message,
        'Igru možeš startovati samo u kanalu koji sadrži "kaladont" u imenu ili opisu.'
      );
    }

    if (game) {
      return sendTempReply(
        message,
        `Već postoji aktivna igra u ovom kanalu.\n Trenutno je na redu ${mention(getCurrentPlayer(game))}.`
      );
    }

    const newGame = createGame(message.channel, authorId);
    const joinButton = new ButtonBuilder()
      .setCustomId('kaladont-join')
      .setLabel('Pridruži se')
      .setStyle(ButtonStyle.Primary);
    const joinRow = new ActionRowBuilder().addComponents(joinButton);

    const lobbyMessage = await message.reply({
      embeds: [makeEmbed({
        title: 'Igra započeta',
        description: `🟢 Igra Kaladont je u lobby-u! ${mention(authorId)} je prvi.\n Drugi igrači se mogu pridružiti sa !join ili !j, ili kliknuti dugme ispod.\n Morate sačekati da igra počne, a onda će svako igrati protiv svih ostalih.\n Imate 2 minute da se pridružite.\n Piši reči bez prefiksa.\n Ako ne odgovoriš u 30 sekundi, gubiš.\n Reč koja se završava sa "-ka" takođe eliminiše igrača.`,
        color: 0x2ecc71,
      })],
      components: [joinRow],
    });

    newGame.lobbyMessage = lobbyMessage;
    return lobbyMessage;
  }

  if (content === '!join' || content === '!j') {
    if (!game) {
      return sendTempReply(message, 'Nema aktivne igre u ovom kanalu.\n Počni sa !start.');
    }

    if (game.state !== 'lobby') {
      return sendTempReply(message, 'Pridruživanje je zatvoreno, igra je već počela.\n Sačekaj sledeću rundu.');
    }

    if (game.players.includes(authorId)) {
      return sendTempReply(message, 'Već si u igri. Sačekaj svoj red.');
    }

    game.players.push(authorId);
    game.scores.set(authorId, 0);
    return replyEmbed(message, {
      title: 'Igrač pridružen',
      description: `${mention(authorId)} se pridružio/la igri.\n Morate sačekati da igra počne.\n Trenutno je na redu ${mention(getCurrentPlayer(game))}.`,
      color: 0x3498db,
    });
  }

  if (content === '!leave') {
    if (!game) return sendTempReply(message, 'Nema aktivne igre u ovom kanalu.');

    if (!game.players.includes(authorId)) {
      return sendTempReply(message, 'Nisi u igri.');
    }

    if (game.state !== 'lobby') {
      return sendTempReply(message, 'Ne možeš izaći nakon što je igra počela.');
    }

    game.players = game.players.filter((id) => id !== authorId);
    game.scores.delete(authorId);

    if (game.players.length === 0) {
      if (game.joinTimeout) {
        clearTimeout(game.joinTimeout);
      }
      clearTurnTimer(game);
      clearTimeInterval(game);
      await disableLobbyButton(game);
      games.delete(channelId);
      return replyEmbed(message, {
        title: 'Igra otkazana',
        description: `${mention(authorId)} je izašao/la. Nema više igrača, igra je otkazana.`,
        color: 0xf39c12,
      });
    }

    return replyEmbed(message, {
      title: 'Igrač izašao',
      description: `${mention(authorId)} je izašao/la iz igre.`,
      color: 0xf39c12,
    });
  }

  if (content === '!forcestart') {
    if (!game) return sendTempReply(message, 'Nema aktivne igre u ovom kanalu.');
    if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return sendTempReply(message, 'Samo administratori mogu forsirati početak igre.');
    }
    if (game.state !== 'lobby') return sendTempReply(message, 'Igra je već počela.');
    if (game.joinTimeout) {
      clearTimeout(game.joinTimeout);
      game.joinTimeout = null;
    }
    await startGame(message.channel);
    return replyEmbed(message, {
      title: 'Igra forsirana',
      description: 'Igra je odmah pokrenuta.',
      color: 0x2ecc71,
    });
  }

  if (content === '!stop') {
    if (!game) {
      return sendTempReply(message, 'Nema aktivne igre.\n Počni sa !start.');
    }

    if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return sendTempReply(message, 'Samo administratori mogu prekinuti igru.');
    }

    if (game.joinTimeout) {
      clearTimeout(game.joinTimeout);
    }
    if (game.gameTimeout) {
      clearTimeout(game.gameTimeout);
    }
    clearTurnTimer(game);
    clearTimeInterval(game);

    if (game.state === 'playing') {
      const results = [...game.scores.entries()];
      results.sort((a, b) => b[1] - a[1]);
      const highestPoints = results.length ? results[0][1] : 0;
      const winners = results.filter(([, points]) => points === highestPoints).map(([id]) => id);
      games.delete(channelId);
      return replyEmbed(message, {
        title: 'Igra prekinuta',
        description: `Igra je prekinuta.\n Najbolji/e: ${winners.map(mention).join(', ')} sa ${highestPoints} bodova.`,
        color: 0xf39c12,
      });
    }

    games.delete(channelId);
    return replyEmbed(message, {
      title: 'Igra prekinuta',
      description: 'Igra je prekinuta. Hvala na igranju.',
      color: 0xf39c12,
    });
  }

  if (content === '!create') {
    if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return sendTempReply(message, 'Samo administratori mogu ovo da rade.');
    }
    if (!message.guild) {
      return sendTempReply(message, 'Ova komanda mora da se izvrši na serveru.');
    }

    const existingChannel = message.guild.channels.cache.find(
      (channel) => channel.name.toLowerCase() === 'kaladont' && channel.type === ChannelType.GuildText
    );

    if (existingChannel) {
      return replyEmbed(message, {
        title: 'Već postoji kanal',
        description: 'Tekst-kanal "Kaladont" već postoji na ovom serveru.',
        color: 0xf39c12,
      });
    }

    try {
      const newChannel = await message.guild.channels.create({
        name: 'kaladont',
        type: ChannelType.GuildText,
        topic: 'Kaladont',
        permissionOverwrites: [
          {
            id: message.guild.roles.everyone.id,
            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
          },
        ],
      });

      return replyEmbed(message, {
        title: 'Kanаl kreiran',
        description: `Tekst-kanal ${newChannel} je uspešno kreiran sa opisom "Kaladont".`,
        color: 0x2ecc71,
      });
    } catch (error) {
      console.error('Channel creation failed:', error);
      return replyEmbed(message, {
        title: 'Greška pri kreiranju kanala',
        description: 'Neuspešno kreiranje kanala.\n Proveri dozvole bota.',
        color: 0xe74c3c,
      });
    }
  }

  if (content.startsWith('!addword ')) {
    if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return sendTempReply(message, 'Samo administratori mogu ovo da rade.');
    }

    const newWord = content.slice('!addword '.length).trim().normalize('NFC');
    if (!newWord) {
      return sendTempReply(message, 'Napiši reč nakon !addword.');
    }

    if (!isValidWord(newWord)) {
      return sendTempReply(message, 'Reč može sadržati samo srpska slova bez razmaka.');
    }

    if (serbianDictionary.has(newWord)) {
      return sendTempReply(message, `Reč "${newWord}" je već u rečniku.`);
    }

    serbianDictionary.add(newWord);
    saveDictionary();
    return replyEmbed(message, {
      title: 'Reč dodata',
      description: `Reč "${newWord}" je dodata u rečnik.`,
      color: 0x2ecc71,
    });
  }

  if (content === '!ping') {
    const latency = Date.now() - message.createdTimestamp;
    return replyEmbed(message, {
      title: 'Ping',
      description: `Pong! Latencija: ${latency}ms.`,
      color: 0x1abc9c,
    });
  }

  if (content === '!version') {
    return replyEmbed(message, {
      title: 'Verzija',
      description: `KalaBot beta verzija ${BOT_VERSION}\n\nBot Owner: empixoxo (Keez)`,
      color: 0x8e44ad,
    });
  }

  if (content === '!help') {
    return replyEmbed(message, {
      title: 'Komande za Kaladont',
      description:
        '📘 Dostupne komande za Kaladont:\n\n' +
        '!start - Pokreće igru u kanalu koji sadrži "kaladont" u imenu ili opisu.\n\n' +
        '!join ili !j - Pridruži se aktivnoj igri.\n\n' +
        '!leave - Napuštaš igru pre nego što počne.\n\n' +
        "!forcestart - Forsira početak igre (samo admin).\n\n" +
        '!stop - Prekida igru u tekućem kanalu.\n\n' +
        '!create - Kreira tekst-kanal "Kaladont" (samo administratori).\n\n' +
        'Pisanje reči bez prefiksa - koristi se za odigravanje u toku igre.\n\n' +
        '!addword <reč> - Dodaje novu reč u rečnik (samo administratori).\n\n' +
        '!ping - Proverava da li je bot aktivan.\n\n' +
        '!version - Prikazuje trenutnu beta verziju bota.\n\n' +
        '!help - Prikazuje ovu poruku sa komandama.',
      color: 0x3498db,
    });
  }

  if (content === '!hello') {
    return replyEmbed(message, {
      title: 'Hello',
      description: 'Hello, world!',
      color: 0x95a5a6,
    });
  }

  if (game) {
    // While lobby is open, block gameplay and point-scoring until the match actually starts
    if (game.state === 'lobby') {
      return sendTempReply(message, 'Igra je u lobby-u. Sačekajte da igra počne pre nego što šaljete reči ili igrate.');
    }

    if (content.startsWith('/')) {
      return sendTempReply(message, 'Korišćenje "/" nije podržano. Koristi !join ili !stop.');
    }

    if (content.startsWith('!') && !['!join', '!j', '!stop', '!forcestart', '!addword', '!hello', '!start', '!create', '!ping', '!version', '!help'].some((cmd) => content.startsWith(cmd))) {
      return sendTempReply(message, 'Nevažeća komanda. Koristi !join, !j, !stop, !start, !forcestart, !create, !ping, !version ili piši reč.');
    }

    if (!game.players.includes(authorId)) {
      return sendTempReply(message, 'Nisi u igri. Pridruži se sa !join ili !j.');
    }

    const currentPlayer = getCurrentPlayer(game);
    if (authorId !== currentPlayer) {
      return sendTempReply(message, `Nije tvoj red. Trenutno je na redu ${mention(currentPlayer)}.`);
    }

    const word = content.normalize('NFC');
    if (!isValidWord(word)) {
      return sendTempReply(message, 'Reč može sadržati samo srpska slova bez razmaka.');
    }

    if (isBannedWord(word)) {
      return sendTempReply(message, 'Proper imenice nisu dozvoljene. Unesi reč koja nije grad, ime, brend ili pojedine ruzne reči.');
    }

    if (game.usedWords.has(word)) {
      return sendTempReply(message, 'Ta reč je već korišćena. Pokušaj drugu reč.');
    }

    if (!isDictionaryWord(word)) {
      return sendTempReply(message, 'Ta reč ne postoji u srpskom rečniku.');
    }

    if (game.requiredPrefix && !word.startsWith(game.requiredPrefix)) {
      return sendTempReply(message, `Reč mora početi sa "${game.requiredPrefix}".`);
    }

    if (word.endsWith('ka')) {
      game.usedWords.add(word);
      const loser = authorId;
      const winners = game.players.filter((id) => id !== loser);
      if (game.joinTimeout) {
        clearTimeout(game.joinTimeout);
      }
      clearTurnTimer(game);
      const eliminated = await eliminatePlayer(channel, game, loser, 'word', `napisao/la "${word}" koja se završava sa "-ka"`);
      if (eliminated) {
        return;
      }

      return replyEmbed(message, {
        title: 'Igra nastavlja',
        description: `❌ ${mention(loser)} je eliminisan/a jer je napisao/la "${word}" koja se završava sa "-ka".`,
        color: 0x3498db,
      });
    }

    const score = computeScore(word);
    const previousScore = game.scores.get(authorId) || 0;
    game.scores.set(authorId, previousScore + score);
    game.usedWords.add(word);
    game.lastWord = word;
    game.requiredPrefix = getRequiredPrefix(word);
    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    clearTurnTimer(game);
    scheduleTurnTimeout(channel, game);

    return replyEmbed(message, {
      title: 'Reč prihvaćena!',
      description: `✅ Reč "${word}" je prihvaćena. Dobio/la si ${score} bodova. Ukupno: ${game.scores.get(authorId)} bodova.\nSledeći je ${mention(getCurrentPlayer(game))}. Reč mora početi sa "${game.requiredPrefix}".`,
      color: 0x2ecc71,
    });
  }
});

client.login(token).catch((error) => {
  console.error('Failed to login:', error);
  process.exit(1);
});
