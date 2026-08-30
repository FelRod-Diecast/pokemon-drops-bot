const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const CHANNEL_ID = process.env.DROPS_CHANNEL_ID;

client.once("clientReady", async () => {
  console.log("PokemonTrackerV2 Online");

  // Target Scanner
  // Sam's Scanner
  // Costco Scanner

});

client.login(process.env.DISCORD_TOKEN);