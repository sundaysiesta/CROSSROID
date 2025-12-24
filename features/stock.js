const { getStockInfo } = require('../lib/stock');
const { MessageFlags } = require('discord.js');

// let stock_data = new Map();

async function clientReady(client) {
	setInterval(async () => {}, 60000);
}

async function interactionCreate(interaction) {
	if (!interaction.isChatInputCommand()) return;

	if (interaction.commandName === 'stock') {
		if (interaction.options.getSubcommand() === 'info') {
			const code = interaction.options.getString('code');
			const stockInfo = await getStockInfo(code);

			if (stockInfo.pageInfo.currentKey === 'stocksContents') {
				const name = stockInfo.mainStocksPriceBoard.priceBoard.name;
				const price = Number(stockInfo.mainStocksPriceBoard.priceBoard.price.replace(',', ''));
				await interaction.reply({
					content: `${name} (${code})\n現在値: ${price} ロメコイン`,
					flags: [MessageFlags.Ephemeral],
				});
			} else {
				await interaction.reply({ content: `現在日本株のみ対応しています`, flags: [MessageFlags.Ephemeral] });
			}
		} else if (interaction.options.getSubcommand() === 'buy') {
			const code = interaction.options.getString('code');
			const quantity = interaction.options.getInteger('quantity');
			const stockInfo = await getStockInfo(code);

			if (stockInfo.pageInfo.currentKey === 'stocksContents') {
				const name = stockInfo.mainStocksPriceBoard.priceBoard.name;
				const price = Number(stockInfo.mainStocksPriceBoard.priceBoard.price.replace(',', ''));
				const total = price * quantity;
				await interaction.reply({
					content: `購入\n${name} (${code}) x${quantity}\n合計: ${total} ロメコイン`,
					flags: [MessageFlags.Ephemeral],
				});
			} else {
				await interaction.reply({ content: `現在日本株のみ対応しています`, flags: [MessageFlags.Ephemeral] });
			}
		} else if (interaction.options.getSubcommand() === 'sell') {
			const code = interaction.options.getString('code');
			const quantity = interaction.options.getInteger('quantity');
			const stockInfo = await getStockInfo(code);

			if (stockInfo.pageInfo.currentKey === 'stocksContents') {
				const name = stockInfo.mainStocksPriceBoard.priceBoard.name;
				const price = Number(stockInfo.mainStocksPriceBoard.priceBoard.price.replace(',', ''));
				const total = price * quantity;
				await interaction.reply({
					content: `売却\n${name} (${code}) x${quantity}\n合計: ${total} ロメコイン`,
					flags: [MessageFlags.Ephemeral],
				});
			} else {
				await interaction.reply({ content: `現在日本株のみ対応しています`, flags: [MessageFlags.Ephemeral] });
			}
		} else if (interaction.options.getSubcommand() === 'portfolio') {
			await interaction.reply({
				content: `ポートフォリオ機能は現在開発中です`,
				flags: [MessageFlags.Ephemeral],
			});
		}
	}
}

module.exports = {
	clientReady,
	interactionCreate,
};
