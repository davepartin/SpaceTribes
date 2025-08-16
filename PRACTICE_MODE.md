# 🎯 Space Tribes Practice Mode

## What is Practice Mode?

Practice Mode allows you to play as **Dave the Endorian** against 5 AI-controlled tribes that follow predictable, strategic patterns. This lets you learn the game mechanics without the unpredictability of human players.

## 🚀 How to Enable/Disable

In `app.js`, you can control practice mode with these settings:

```javascript
const PRACTICE_MODE = true; // Set to false to disable AI tribes
const PRACTICE_MODE_PLAYER = 'Dave'; // Only this player gets AI opponents
```

## 🤖 AI Tribe Personalities

### **Silas - Aggressive Raider**
- **Mining**: 3💎 2🔻 2🔷 3🌱 (8 total)
- **Selling**: 8💎 6🔻 5🔷 10🌱
- **Raiding**: 80% chance to raid Dave for White Diamonds
- **Strategy**: High-risk, high-reward player who focuses on raiding

### **Chris - Conservative Miner**
- **Mining**: 4💎 3🔻 2🔷 1🌱 (10 total)
- **Selling**: 5💎 4🔻 3🔷 2🌱
- **Raiding**: 30% chance to raid Dave for Red Rubies
- **Strategy**: Safe, steady mining with minimal raiding

### **Brian - Balanced Player**
- **Mining**: 2💎 3🔻 3🔷 2🌱 (10 total)
- **Selling**: 6💎 7🔻 8🔷 6🌱
- **Raiding**: 50% chance to raid Silas for Blue Gems
- **Strategy**: Well-rounded approach to all aspects of the game

### **Joel - Resource Specialist**
- **Mining**: 1💎 1🔻 5🔷 3🌱 (10 total)
- **Selling**: 3💎 2🔻 12🔷 8🌱
- **Raiding**: 60% chance to raid Chris for Green Poison
- **Strategy**: Focuses heavily on Blue Gems and Green Poison

### **Curtis - Opportunistic Trader**
- **Mining**: 2💎 2🔻 2🔷 4🌱 (10 total)
- **Selling**: 7💎 6🔻 5🔷 10🌱
- **Raiding**: 40% chance to raid Brian for White Diamonds
- **Strategy**: Adapts selling based on market prices

## 🎮 How to Use Practice Mode

1. **Start the server**: `npm run dev` or `npm start`
2. **Open your browser**: Go to http://localhost:3000
3. **Login as Dave**: Use PIN 1234 (or whatever you set)
4. **Play normally**: The AI tribes will automatically make decisions each night
5. **Watch the news**: See what the AI tribes are doing each turn

## 🔄 AI Behavior Patterns

- **Day Variation**: AI mining varies slightly each day (-1 to +1 robots)
- **Price Sensitivity**: AI sells more when prices are high
- **Resource Management**: AI respects stockpile limits and Green Poison requirements
- **Strategic Raiding**: Each AI has preferred targets and resources

## 🎯 Practice Scenarios

### **Scenario 1: Learn Mining**
- Focus on deploying your 10 robots efficiently
- Watch how AI tribes distribute their robots
- Learn which resources are most valuable

### **Scenario 2: Master Trading**
- Study how AI tribes react to price changes
- Practice timing your sales for maximum profit
- Understand the supply/demand dynamics

### **Scenario 3: Defend Against Raids**
- Silas will frequently target you for White Diamonds
- Learn to balance mining vs. keeping resources safe
- Practice using Green Poison for your own raids

### **Scenario 4: Market Manipulation**
- See how your mining affects everyone's prices
- Learn to predict price movements
- Practice strategic resource allocation

## 🛠️ Customizing AI Behavior

You can modify the AI strategies in the `generateAIDecisions()` function:

- **Change mining patterns**: Adjust the base mining amounts
- **Modify raiding frequency**: Change the raid probability (0.0 to 1.0)
- **Adjust selling behavior**: Modify how AI responds to prices
- **Create new personalities**: Add unique strategies for each tribe

## 🎲 Tips for Practice Mode

1. **Start Simple**: Focus on one aspect at a time
2. **Watch the News**: Learn from AI behavior patterns
3. **Experiment**: Try different strategies without pressure
4. **Take Notes**: Track what works and what doesn't
5. **Graduate**: Once comfortable, switch to normal mode for real competition

## 🚀 Ready to Practice?

Your Space Tribes practice mode is now active! The AI tribes will provide consistent, strategic opponents while you learn the game. Happy mining, Commander Dave! 🐻💎
