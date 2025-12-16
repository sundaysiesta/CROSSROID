
  // 繧ｹ繝ｩ繝・す繝･繧ｳ繝槭Φ繝峨ｒ逋ｻ骭ｲ
  const commands = [
    {
      name: 'anonymous',
      description: '蛹ｿ蜷阪〒繝｡繝・そ繝ｼ繧ｸ繧帝∽ｿ｡縺励∪縺・,
      options: [
        {
          name: '蜀・ｮｹ',
          description: '騾∽ｿ｡縺吶ｋ繝｡繝・そ繝ｼ繧ｸ・・56譁・ｭ嶺ｻ･荳九∵隼陦檎ｦ∵ｭ｢・・,
          type: 3, // STRING
          required: true
        }
      ]
    },
    {
      name: 'anonymous_resolve',
      description: '蛹ｿ蜷巧D縺九ｉ騾∽ｿ｡閠・ｒ迚ｹ螳夲ｼ磯°蝟ｶ蟆ら畑・・,
      options: [
        {
          name: '蛹ｿ蜷絞d',
          description: '陦ｨ遉ｺ蜷阪↓蜷ｫ縺ｾ繧後ｋ蛹ｿ蜷巧D・井ｾ・ a1b2c3・・,
          type: 3,
          required: true
        },
        {
          name: '譌･莉・,
          description: 'UTC譌･莉・YYYY-MM-DD・育怐逡･譎ゅ・蠖捺律・・,
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'bump',
      description: '驛ｨ豢ｻ繝√Ε繝ｳ繝阪Ν繧貞ｮ｣莨昴＠縺ｾ縺呻ｼ・譎る俣縺ｫ1蝗槭∪縺ｧ・・
    },
    {
      name: 'test_generation',
      description: '荳紋ｻ｣迯ｲ蠕鈴夂衍縺ｮ繝・せ繝茨ｼ磯°蝟ｶ蟆ら畑・・,
      options: [
        {
          name: '繝ｦ繝ｼ繧ｶ繝ｼ',
          description: '繝・せ繝亥ｯｾ雎｡縺ｮ繝ｦ繝ｼ繧ｶ繝ｼ',
          type: 6, // USER
          required: true
        }
      ]
    },
    {
      name: 'test_timereport',
      description: '譎ょｱ讖溯・縺ｮ繝・せ繝茨ｼ磯°蝟ｶ蟆ら畑・・,
      options: [
        {
          name: '譎る俣',
          description: '繝・せ繝医☆繧区凾髢難ｼ・-23・・,
          type: 4, // INTEGER
          required: true
        }
      ]
    },
    {
      name: 'random_mention',
      description: '繧ｵ繝ｼ繝舌・繝｡繝ｳ繝舌・繧偵Λ繝ｳ繝繝縺ｧ繝｡繝ｳ繧ｷ繝ｧ繝ｳ縺励∪縺・
    },
    {
      name: 'event_create',
      description: '繧､繝吶Φ繝育畑繝√Ε繝ｳ繝阪Ν繧剃ｽ懈・縺励∝相遏･繧定｡後＞縺ｾ縺・,
      options: [
        {
          name: '繧､繝吶Φ繝亥錐',
          description: '繧､繝吶Φ繝医・繧ｿ繧､繝医Ν・医メ繝｣繝ｳ繝阪Ν蜷阪↓縺ｪ繧翫∪縺呻ｼ・,
          type: 3, // STRING
          required: true
        },
        {
          name: '蜀・ｮｹ',
          description: '繧､繝吶Φ繝医・隧ｳ邏ｰ蜀・ｮｹ',
          type: 3, // STRING
          required: true
        },
        {
          name: '譌･譎・,
          description: '髢句ぎ譌･譎ゑｼ井ｻｻ諢擾ｼ・,
          type: 3, // STRING
          required: false
        },
        {
          name: '蝣ｴ謇',
          description: '髢句ぎ蝣ｴ謇・井ｻｻ諢擾ｼ・,
          type: 3, // STRING
          required: false
        }
      ]
    },

    // === Admin Suite ===
    {
      name: 'admin_control',
      description: '繝√Ε繝ｳ繝阪Ν邂｡逅・ｼ医Ο繝・け/隗｣髯､/菴朱・Wipe・・,
      options: [
        {
          name: 'lock',
          description: '繝√Ε繝ｳ繝阪Ν繧偵Ο繝・け縺励∪縺・,
          type: 1, // SUB_COMMAND
          options: [{ name: 'channel', description: '蟇ｾ雎｡繝√Ε繝ｳ繝阪Ν', type: 7, required: false }]
        },
        {
          name: 'unlock',
          description: '繝√Ε繝ｳ繝阪Ν縺ｮ繝ｭ繝・け繧定ｧ｣髯､縺励∪縺・,
          type: 1,
          options: [{ name: 'channel', description: '蟇ｾ雎｡繝√Ε繝ｳ繝阪Ν', type: 7, required: false }]
        },
        {
          name: 'slowmode',
          description: '菴朱溘Δ繝ｼ繝峨ｒ險ｭ螳壹＠縺ｾ縺・,
          type: 1,
          options: [
            { name: 'seconds', description: '遘呈焚(0隗｣髯､)', type: 4, required: true },
            { name: 'channel', description: '蟇ｾ雎｡繝√Ε繝ｳ繝阪Ν', type: 7, required: false }
          ]
        },
        {
          name: 'wipe',
          description: '縲仙些髯ｺ縲代メ繝｣繝ｳ繝阪Ν繧貞・逕滓・縺励※繝ｭ繧ｰ繧呈ｶ亥悉縺励∪縺・,
          type: 1,
          options: [{ name: 'channel', description: '蟇ｾ雎｡繝√Ε繝ｳ繝阪Ν', type: 7, required: true }]
        }
      ]
    },
    {
      name: 'admin_user_mgmt',
      description: '繝ｦ繝ｼ繧ｶ繝ｼ邂｡逅・ｼ亥・鄂ｰ/隗｣髯､/諠・ｱ/謫堺ｽ懶ｼ・,
      options: [
        {
          name: 'action',
          description: '蜃ｦ鄂ｰ縺ｾ縺溘・隗｣髯､繧定｡後＞縺ｾ縺・,
          type: 1,
          options: [
            { name: 'target', description: '蟇ｾ雎｡繝ｦ繝ｼ繧ｶ繝ｼ', type: 6, required: true },
            {
              name: 'type',
              description: '謫堺ｽ懊ち繧､繝・,
              type: 3,
              required: true,
              choices: [
                { name: 'Timeout', value: 'timeout' },
                { name: 'Untimeout', value: 'untimeout' },
                { name: 'Kick', value: 'kick' },
                { name: 'Ban', value: 'ban' },
                { name: 'Unban', value: 'unban' }
              ]
            },
            { name: 'reason', description: '逅・罰', type: 3, required: false },
            { name: 'duration', description: 'Timeout譛滄俣(蛻・', type: 4, required: false }
          ]
        },
        {
          name: 'nick',
          description: '繝九ャ繧ｯ繝阪・繝繧貞､画峩縺励∪縺・,
          type: 1,
          options: [
            { name: 'target', description: '蟇ｾ雎｡繝ｦ繝ｼ繧ｶ繝ｼ', type: 6, required: true },
            { name: 'name', description: '譁ｰ縺励＞蜷榊燕(遨ｺ谺・〒繝ｪ繧ｻ繝・ヨ)', type: 3, required: false } // Discord allows empty to reset? Usually commands need content. Optional 'name'
          ]
        },
        {
          name: 'dm',
          description: 'Bot縺九ｉDM繧帝∽ｿ｡縺励∪縺・,
          type: 1,
          options: [
            { name: 'target', description: '騾∽ｿ｡蜈医Θ繝ｼ繧ｶ繝ｼ', type: 6, required: true },
            { name: 'content', description: '蜀・ｮｹ', type: 3, required: true },
            { name: 'anonymous', description: '蛹ｿ蜷・Bot蜷咲ｾｩ)縺ｫ縺吶ｋ縺・, type: 5, required: false }
          ]
        },
        {
          name: 'whois',
          description: '繝ｦ繝ｼ繧ｶ繝ｼ縺ｮ隧ｳ邏ｰ諠・ｱ繧定｡ｨ遉ｺ縺励∪縺・,
          type: 1,
          options: [{ name: 'target', description: '蟇ｾ雎｡繝ｦ繝ｼ繧ｶ繝ｼ', type: 6, required: true }]
        }
      ]
    },
    {
      name: 'admin_logistics',
      description: '繝ｭ繧ｸ繧ｹ繝・ぅ繧ｯ繧ｹ・育ｧｻ蜍・菴懈・/蜑企勁/逋ｺ險・・,
      options: [
        {
          name: 'move_all',
          description: 'VC蜿ょ刈閠・ｒ蜈ｨ蜩｡遘ｻ蜍輔＆縺帙∪縺・,
          type: 1,
          options: [
            { name: 'from', description: '遘ｻ蜍募・VC', type: 7, required: true }, // ChannelType check in logic
            { name: 'to', description: '遘ｻ蜍募・VC', type: 7, required: true }
          ]
        },
        {
          name: 'say',
          description: 'Bot縺ｨ縺励※逋ｺ險縺励∪縺・,
          type: 1,
          options: [
            { name: 'channel', description: '騾∽ｿ｡蜈・, type: 7, required: true },
            { name: 'content', description: '蜀・ｮｹ', type: 3, required: true }
          ]
        },
        {
          name: 'create',
          description: '繝√Ε繝ｳ繝阪Ν菴懈・',
          type: 1,
          options: [
            { name: 'name', description: '蜷榊燕', type: 3, required: true },
            { name: 'type', description: '繧ｿ繧､繝・text/voice)', type: 3, required: false, choices: [{ name: 'Text', value: 'text' }, { name: 'Voice', value: 'voice' }] },
            { name: 'category', description: '繧ｫ繝・ざ繝ｪID', type: 3, required: false }
          ]
        },
        {
          name: 'delete',
          description: '繝√Ε繝ｳ繝阪Ν蜑企勁',
          type: 1,
          options: [
            { name: 'channel', description: '蟇ｾ雎｡', type: 7, required: true },
            { name: 'reason', description: '逅・罰', type: 3, required: false }
          ]
        },
        {
          name: 'purge',
          description: '繝｡繝・そ繝ｼ繧ｸ荳諡ｬ蜑企勁',
          type: 1,
          options: [
            { name: 'amount', description: '莉ｶ謨ｰ', type: 4, required: true, minValue: 1, maxValue: 100 },
            { name: 'user', description: '蟇ｾ雎｡繝ｦ繝ｼ繧ｶ繝ｼ', type: 6, required: false },
            { name: 'keyword', description: '繧ｭ繝ｼ繝ｯ繝ｼ繝・, type: 3, required: false },
            { name: 'channel', description: '繝√Ε繝ｳ繝阪Ν', type: 7, required: false }
          ]
        },
        {
          name: 'role',
          description: '繝ｭ繝ｼ繝ｫ謫堺ｽ・,
          type: 1,
          options: [
            { name: 'target', description: '繝ｦ繝ｼ繧ｶ繝ｼ', type: 6, required: true },
            { name: 'role', description: '繝ｭ繝ｼ繝ｫ', type: 8, required: true },
            { name: 'action', description: '謫堺ｽ・, type: 3, required: true, choices: [{ name: 'give', value: 'give' }, { name: 'take', value: 'take' }] }
          ]
        },
        // === Poll System ===
        {
          name: 'poll',
          description: '謚慕･ｨ繧剃ｽ懈・繝ｻ邂｡逅・＠縺ｾ縺・,
          options: [
            {
              name: 'create',
              description: '謚慕･ｨ繧剃ｽ懈・縺励∪縺・,
              type: 1,
              options: [
                { name: 'config', description: '險ｭ螳壹ユ繧ｭ繧ｹ繝・Manifesto)', type: 3, required: false },
                { name: 'file', description: '險ｭ螳壹ヵ繧｡繧､繝ｫ(.txt)', type: 11, required: false }
              ]
            },
            {
              name: 'end',
              description: '謚慕･ｨ繧堤ｵゆｺ・＠縺ｾ縺・,
              type: 1,
              options: [{ name: 'id', description: 'Poll ID (Footer蜿ら・)', type: 3, required: true }]
            },
            {
              name: 'status',
              description: '謚慕･ｨ縺ｮ騾比ｸｭ邨碁℃繧堤｢ｺ隱阪＠縺ｾ縺呻ｼ育ｮ｡逅・・ｰら畑・・,
              type: 1,
              options: [{ name: 'id', description: 'Poll ID', type: 3, required: true }]
            },
            {
              name: 'result',
              description: '謚慕･ｨ邨先棡繧貞・髢九・逋ｺ陦ｨ縺励∪縺呻ｼ育ｮ｡逅・・ｰら畑・・,
              type: 1,
              options: [{ name: 'id', description: 'Poll ID', type: 3, required: true }]
            }
          ]
        }
      ];

      try {
        console.log('繧ｹ繝ｩ繝・す繝･繧ｳ繝槭Φ繝峨ｒ逋ｻ骭ｲ荳ｭ...');
        await client.application.commands.set(commands);
