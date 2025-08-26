// index.js
require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // required if you want a message command like !ticket
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

const BOT_PREFIX = "!"; // you can change to slash commands later

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  // simple message command to post ticket button: send "!ticket" in a channel
  if (message.content.trim() === `${BOT_PREFIX}ticket`) {
    const createBtn = new ButtonBuilder()
      .setCustomId("create_ticket")
      .setLabel("🎫 Open Ticket")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(createBtn);
    const embed = new EmbedBuilder()
      .setTitle("Support Ticket")
      .setDescription("Click the button below to create a private ticket channel.")
      .setColor(0x5865f2);

    await message.channel.send({ embeds: [embed], components: [row] });
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  // CREATE TICKET
  if (interaction.customId === "create_ticket") {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const user = interaction.user;

    // check if user already has an open ticket (by channel name)
    const existing = guild.channels.cache.find(
      (c) => c.name === `ticket-${user.id}`
    );
    if (existing) {
      return interaction.editReply({
        content: `You already have a ticket: ${existing.toString()}`,
      });
    }

    // permission overwrites
    const permissionOverwrites = [
      {
        id: guild.id, // @everyone
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];

    // optional: grant a staff role access if provided via env var
    if (process.env.STAFF_ROLE_ID) {
      permissionOverwrites.push({
        id: process.env.STAFF_ROLE_ID,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }

    try {
      const channelOptions = {
        name: `ticket-${user.id}`,
        type: ChannelType.GuildText,
        permissionOverwrites,
        reason: `Ticket created by ${user.tag}`,
      };

      // optionally set a parent category if provided
      if (process.env.TICKET_CATEGORY_ID) {
        channelOptions.parent = process.env.TICKET_CATEGORY_ID;
      }

      const ticketChannel = await guild.channels.create(channelOptions);

      const closeBtn = new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("🔒 Close Ticket")
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(closeBtn);

      const ticketEmbed = new EmbedBuilder()
        .setTitle("New Ticket")
        .setDescription(
          `Hello <@${user.id}> — Please describe your issue. Staff will join shortly.`
        )
        .setFooter({ text: `Ticket for ${user.tag}` })
        .setTimestamp();

      await ticketChannel.send({
        content: `<@${user.id}>`,
        embeds: [ticketEmbed],
        components: [row],
      });

      await interaction.editReply({
        content: `✅ Your ticket has been created: ${ticketChannel.toString()}`,
      });
    } catch (err) {
      console.error("Failed to create ticket channel:", err);
      await interaction.editReply({
        content: `❌ Failed to create ticket. Make sure I have Manage Channels permission and role is high enough.`,
      });
    }
  }

  // CLOSE TICKET
  if (interaction.customId === "close_ticket") {
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel;
    const guild = interaction.guild;
    const user = interaction.user;

    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.editReply({ content: "This button must be used inside a ticket channel." });
    }

    // basic check: channel name must be ticket-<userid>
    if (!channel.name?.startsWith("ticket-")) {
      return interaction.editReply({ content: "This is not a ticket channel." });
    }

    // owner id parsed from channel name
    const ownerId = channel.name.split("ticket-")[1];

    // fetch member to check permissions/roles reliably
    let member;
    try {
      member = await guild.members.fetch(user.id);
    } catch { member = null; }

    const isOwner = user.id === ownerId;
    const isStaff =
      (process.env.STAFF_ROLE_ID && member && member.roles.cache.has(process.env.STAFF_ROLE_ID)) ||
      (member && member.permissions.has(PermissionFlagsBits.ManageChannels));

    if (!isOwner && !isStaff) {
      return interaction.editReply({ content: "Only the ticket owner or staff can close this ticket." });
    }

    // Option: rename + lock then delete after 5s. Change this if you'd prefer just archiving.
    try {
      await channel.setName(`closed-${channel.name}`).catch(() => {});
      await channel.permissionOverwrites.edit(ownerId, { ViewChannel: false }).catch(() => {});
      await interaction.editReply({ content: "Closing ticket — channel will be deleted in 5 seconds." });

      setTimeout(async () => {
        try {
          await channel.delete(`Ticket closed by ${user.tag}`);
        } catch (err) {
          console.error("Failed to delete ticket channel:", err);
        }
      }, 5000);
    } catch (err) {
      console.error("Error closing ticket:", err);
      await interaction.editReply({ content: "Failed to close ticket." });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
