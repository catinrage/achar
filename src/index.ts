import { Parser } from '$src/lib/parser';
import { Program } from '$src/lib/program';

// Add similar definitions for other section-specific fields if needed
const source = await Bun.file('./data/Setup1-TR.MPF').text();

// Example Usage
const inputText = source; // Replace with your actual text
const parser = new Parser(inputText);
const parsedEvents = parser.parse(); // Parse the input text

await Bun.write('./generated/ir.json', JSON.stringify(parsedEvents, null, 2));

const program = new Program();

program.on('MFeedSpin', (params, $) => {
  $.SetSpindleSpeed(params.spin);
  $.SetSpindleDirection(params.spin_direction);
});

program.on('RapidMove', (params, $) => {
  $.Rapid({
    x: params.xpos,
    y: params.ypos,
    z: params.zpos,
  });
});

program.on('Line', (params, $) => {
  $.Line({
    x: params.xpos,
    y: params.ypos,
    z: params.zpos,
  });
});

// program.trigger('MFeedSpin', {
//   spin: 1000,
// });

// program.loadEvents(parsedEvents); // Load parsed events into the program
program.process(); // Process the events, triggering the listeners
console.log(program.generate()); // Generate the G-code
