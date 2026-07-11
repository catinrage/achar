import { FeedRateModeEnum } from '../packages/core/src/common/enums';
import { Logger, LogLevel } from '../packages/core/src/lib/logger';
import { Parser } from '../packages/core/src/lib/parser';
import { Program } from '../packages/core/src/lib/program';

// Add similar definitions for other section-specific fields if needed
const source = await Bun.file(
  './fixtures/PROJECT_567_112250296390862_CAM_Milling/567_112250296390862_CAM_Milling.MPF',
).text();

Logger.setGlobalOptions({
  enabled: true,
});

// Example Usage
const inputText = source; // Replace with your actual text
const parser = new Parser(inputText, {
  logLevel: LogLevel.FATAL,
});
const parsedEvents = parser.parse(); // Parse the input text

await Bun.write('./generated/ir.json', JSON.stringify(parsedEvents, null, 2));

const program = new Program({
  programName: 'Setup',
  numbering: {
    start: 100,
    increment: 20,
  },
});

program.on('StartOfFile', ($, params) => {
  if (params.inch_system) {
    $.UseInches({
      skipNewLine: true,
    });
  } else {
    $.UseMillimeters({
      skipNewLine: true,
    });
  }
  $.SetFeedRateMode(FeedRateModeEnum.UNITS_PER_MINUTE, {
    skipNewLine: true,
  });
});

program.on('AbsoluteMode', ($) => {
  $.SetAbsoluteMode({
    skipNewLine: true,
  });
});

program.on('MachinePlane', ($, params) => {
  $.SetMachinePlane(params.machine_plane);
});

program.on('StartOfJob', ($, params, metadata) => {
  $.OpenFile(params.job_name);

  const lastToolChangeEvent = metadata.findLastEvent('ToolChange');
  if (lastToolChangeEvent) {
    $.SelectTool(lastToolChangeEvent.data.tool_id_string, {
      skipNewLine: true,
    })
      .ChangeTool()
      .SelectTool(lastToolChangeEvent.data.next_tool_id_string);
  }
});

program.on('EndOfJob', ($, _, metadata) => {
  $.put('RET');
  $.CloseFile();
  $.Call(metadata.findLastEventOrThrow('StartOfJob').data.job_name);
});

let index = 0;

program.on('DefTool', ($, params, { eventCallCounter }) => {
  $.OpenFile('Tools_Length_Measurement', 'MPF', 'append');
  if (eventCallCounter === 0) {
    $.Comment('Tools Used In This Program :', {});
  }

  if (index === 0) {
    $.SelectTool(params.tool_id_string).ChangeTool();
  } else {
    $.SelectTool(params.tool_id_string);
    $.put('BZ9912(0,,)');
    $.OptionalStop();
    $.ChangeTool();
  }

  index++;
});

program.on('StartProgram', ($) => {
  $.put('BZ9912(0,,)');
  $.ProgramEnd();

  $.CloseFile();
});

program.on('MFeedSpin', ($, params, _metadata) => {
  $.SetSpindleSpeed(params.spin);
  $.SetSpindleDirection(params.spin_direction);
  // console.log(
  //   metadata.currentFile.name,
  //   metadata.currentFile.type,
  //   params.spin_direction,
  // );
});

program.on('RapidMove', ($, params) => {
  $.Rapid({
    x: params.xpos,
    y: params.ypos,
    z: params.zpos,
  });
});

program.on('Line', ($, params) => {
  $.Line(
    {
      x: params.xpos,
      y: params.ypos,
      z: params.zpos,
    },
    {
      skipNewLine: true,
    },
  );
  $.SetFeedRate(params.feed);
});

program.loadEvents(parsedEvents); // Load parsed events into the program
program.process(); // Process the events, triggering the listeners
// console.log(program.generate()); // Generate the G-code

// save all files in the generated folder
program.generate().forEach((file) => {
  Bun.write(`./generated/${file.file}`, file.code);
});

// program._builder._machine.tool._log.forEach((log) => {
//   console.log(log.eventListenerIndex);
// });
