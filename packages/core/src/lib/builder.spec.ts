import { beforeEach, describe, expect, it } from 'vitest';
import { DirectionEnum, PlaneEnum } from '../common/enums';
import { Builder } from './builder';
import { File } from './file';

describe('Builder', () => {
  let builder: Builder;

  beforeEach(() => {
    builder = new Builder();
  });

  describe('Constructor', () => {
    it('should initialize with default options', () => {
      expect(builder).toBeDefined();
      expect(builder.mainFile).toBeDefined();
      expect(builder.currentFile).toBe(builder.mainFile);
    });

    it('should accept custom options', () => {
      const customBuilder = new Builder({
        mainFileName: 'CustomProgram.MPF',
        numbering: {
          enabled: false,
          start: 100,
          increment: 5,
        },
      });
      expect(customBuilder).toBeDefined();
      expect(customBuilder.mainFile.name).toBe('CustomProgram.MPF');
    });
  });

  describe('Basic G-code Generation', () => {
    it('should generate program start and end', () => {
      builder.put('%');
      builder.put('O1000');
      builder.put('M30');
      builder.put('%');

      const result = builder.build();
      expect(result).toHaveLength(1);
      expect(result[0].code).toContain('%');
      expect(result[0].code).toContain('O1000');
      expect(result[0].code).toContain('M30');
    });

    it('should handle line numbering', () => {
      builder.put('G0 X0 Y0');
      builder.put('G1 X10 Y10');

      const result = builder.build();
      expect(result[0].code).toContain('N10');
      expect(result[0].code).toContain('N20');
    });

    it('should keep line numbering continuous across files', () => {
      builder.put('G710');
      builder.OpenFile('OP1');
      builder.put('G0 X0');
      builder.CloseFile();
      builder.OpenFile('OP2');
      builder.put('G0 X1');
      builder.CloseFile();
      builder.put('M2');

      const result = builder.build();
      expect(
        result.find((file) => file.file === 'TestSetup.MPF'),
      ).toBeUndefined();
      expect(result.find((file) => file.file === 'Setup.MPF')?.code).toContain(
        'N10 G710\nN40 M2',
      );
      expect(result.find((file) => file.file === 'OP1.SPF')?.code).toContain(
        'N20 G0 X0',
      );
      expect(result.find((file) => file.file === 'OP2.SPF')?.code).toContain(
        'N30 G0 X1',
      );
    });

    it('should add unnumbered blank lines without advancing line numbers', () => {
      builder.put('G710');
      builder.BlankLine();
      builder.put('G90');

      const result = builder.build();
      expect(result[0].code).toBe('N10 G710\n\nN20 G90');
    });

    it('should handle skipNewLine option', () => {
      builder.put('G0', { skipNewLine: true });
      builder.put('X10', { skipNewLine: true });
      builder.put('Y20');

      const result = builder.build();
      const lines = result[0].code.split('\n');
      expect(lines.some((line) => line.includes('G0 X10 Y20'))).toBe(true);
    });

    it('should emit typed words and blocks without raw put', () => {
      builder.Block([
        { letter: 'G', value: 0 },
        { letter: 'X', value: 10 },
        { letter: 'Y', value: 20 },
      ]);
      builder.CoolantOn();
      builder.SpindleStop();
      builder.ProgramEndAndRewind();

      const result = builder.build();
      expect(result[0].code).toContain('N10 G0 X10 Y20');
      expect(result[0].code).toContain('N20 M8');
      expect(result[0].code).toContain('N30 M5');
      expect(result[0].code).toContain('N40 M30');
    });

    it('should create and cache typed driver APIs', () => {
      const driver = {
        id: 'test-driver',
        create: (target: Builder) => ({
          Marker(text: string) {
            target.Comment(`driver:${text}`);
          },
        }),
      };

      const first = builder.driver(driver);
      const second = builder.driver(driver);
      first.Marker('ok');

      expect(first).toBe(second);
      expect(builder.build()[0].code).toContain('; driver:ok');
    });
  });

  describe('Motion Commands', () => {
    it('should generate rapid moves', () => {
      builder.Rapid({ x: 10, y: 20, z: 5 });

      const result = builder.build();
      expect(result[0].code).toContain('G0');
      expect(result[0].code).toContain('X10');
      expect(result[0].code).toContain('Y20');
      expect(result[0].code).toContain('Z5');
    });

    it('should generate linear moves', () => {
      builder.Line({ x: 100, y: 200, z: -10 });

      const result = builder.build();
      expect(result[0].code).toContain('G1');
      expect(result[0].code).toContain('X100');
      expect(result[0].code).toContain('Y200');
      expect(result[0].code).toContain('Z-10');
    });

    it('should handle partial coordinates', () => {
      builder.Rapid({ x: 10 });
      builder.Line({ y: 20, z: 5 });

      const result = builder.build();
      expect(result[0].code).toContain('X10');
      expect(result[0].code).toContain('Y20');
      expect(result[0].code).toContain('Z5');
    });
  });

  describe('Spindle and Feed Commands', () => {
    it('should set spindle speed', () => {
      builder.SetSpindleSpeed(1500);

      const result = builder.build();
      expect(result[0].code).toContain('S1500');
    });

    it('should set spindle direction', () => {
      builder.SetSpindleDirection(DirectionEnum.CW);

      const result = builder.build();
      expect(result[0].code).toContain('M3');
    });

    it('should set feed rate', () => {
      builder.SetFeedRate(800);

      const result = builder.build();
      expect(result[0].code).toContain('F800');
    });
  });

  describe('Tool Commands', () => {
    it('should select tool', () => {
      builder.SelectTool('T1');

      const result = builder.build();
      expect(result[0].code).toContain('T="T1"');
    });

    it('should change tool', () => {
      builder.ChangeTool();

      const result = builder.build();
      expect(result[0].code).toContain('M6');
    });

    it('should combine tool selection and change', () => {
      builder.SelectTool('T2');
      builder.ChangeTool();

      const result = builder.build();
      expect(result[0].code).toContain('T="T2"');
      expect(result[0].code).toContain('M6');
    });
  });

  describe('Machine Settings', () => {
    it('should set machine plane', () => {
      builder.SetMachinePlane(PlaneEnum.XY);

      const result = builder.build();
      expect(result[0].code).toContain('G17');
    });

    it('should set unit system', () => {
      builder.UseMillimeters();

      const result = builder.build();
      expect(result[0].code).toContain('G710');
    });

    it('should set positioning mode', () => {
      builder.SetAbsoluteMode();

      const result = builder.build();
      expect(result[0].code).toContain('G90');
    });

    it('should set incremental mode', () => {
      builder.SetIncrementalMode();

      const result = builder.build();
      expect(result[0].code).toContain('G91');
    });
  });

  describe('Subprogram Management', () => {
    it('should create and end subprograms', () => {
      builder.OpenFile('Test');
      builder.put('G1 X10 Y10');
      builder.CloseFile();

      const result = builder.build();
      expect(result).toHaveLength(2);
      expect(result[1].file).toBe('Test.SPF');
      expect(result[1].code).toContain('G1 X10 Y10');
    });

    it('should call subprograms', () => {
      builder.Call('TestSub');

      const result = builder.build();
      expect(result[0].code).toContain('CALL "TestSub"');
    });

    it('should call external subprograms', () => {
      builder.ExtCall('ExternalSub');

      const result = builder.build();
      expect(result[0].code).toContain('EXTCALL "ExternalSub"');
    });

    it('should throw error when creating subprogram from non-main file', () => {
      builder.OpenFile('Test1');
      expect(() => builder.OpenFile('Test2')).toThrow();
    });

    it('should throw error when ending main file', () => {
      expect(() => builder.CloseFile()).toThrow();
    });
  });

  describe('State Management', () => {
    it('should not repeat identical commands', () => {
      builder.SetSpindleSpeed(1000);
      builder.SetSpindleSpeed(1000);

      const result = builder.build();
      const matches = result[0].code.match(/S1000/g);
      expect(matches).toHaveLength(1);
    });

    it('should output changed values', () => {
      builder.SetSpindleSpeed(1000);
      builder.SetSpindleSpeed(1500);

      const result = builder.build();
      expect(result[0].code).toContain('S1000');
      expect(result[0].code).toContain('S1500');
    });

    it('should force print when requested', () => {
      builder.SetSpindleSpeed(1000);
      builder.SetSpindleSpeed(1000, { forcePrint: true });

      const result = builder.build();
      const matches = result[0].code.match(/S1000/g);
      expect(matches).toHaveLength(2);
    });
  });

  describe('Complex Program Generation', () => {
    it('should generate a complete machining program', () => {
      // Program header
      builder.put('%');
      builder.put('O2000');
      builder.UseMillimeters();
      builder.SetAbsoluteMode();

      // Tool change
      builder.SelectTool('T1');
      builder.ChangeTool();
      builder.SetSpindleSpeed(2000);
      builder.SetSpindleDirection(DirectionEnum.CW);
      builder.SetFeedRate(500);

      // Machining operations
      builder.Rapid({ x: 0, y: 0, z: 10 });
      builder.Line({ z: 0 });
      builder.Line({ x: 10, y: 10 });
      builder.Line({ x: 0, y: 10 });
      builder.Line({ x: 0, y: 0 });
      builder.Rapid({ z: 10 });

      // Program end
      builder.put('M30');
      builder.put('%');

      const result = builder.build();
      expect(result[0].code).toContain('O2000');
      expect(result[0].code).toContain('G710');
      expect(result[0].code).toContain('T="T1"');
      expect(result[0].code).toContain('M6');
      expect(result[0].code).toContain('S2000');
      expect(result[0].code).toContain('M3');
      expect(result[0].code).toContain('F500');
      expect(result[0].code).toContain('G0');
      expect(result[0].code).toContain('G1');
      expect(result[0].code).toContain('M30');
    });
  });
});

describe('File', () => {
  let builder: Builder;
  let file: File;

  beforeEach(() => {
    builder = new Builder();
    file = new File(builder, 'Test.SPF');
  });

  describe('Constructor', () => {
    it('should initialize with correct properties', () => {
      expect(file.name).toBe('Test.SPF');
      expect(file.type).toBe('Sub');
      expect(file.gcode).toBe('');
    });

    it('should accept custom options', () => {
      const customFile = new File(builder, 'Custom.SPF', 'Main', {
        numbering: {
          enabled: false,
          start: 100,
          increment: 5,
        },
      });
      expect(customFile.name).toBe('Custom.SPF');
      expect(customFile.type).toBe('Main');
    });
  });

  describe('G-code Generation', () => {
    it('should add and flush G-code lines', () => {
      file.put('G0 X10 Y20');
      file.put('G1 X30 Y40');

      expect(file.gcode).toContain('G0 X10 Y20');
      expect(file.gcode).toContain('G1 X30 Y40');
    });

    it('should handle line numbering', () => {
      file.put('G0 X0 Y0');
      file.put('G1 X10 Y10');

      expect(file.gcode).toContain('N10');
      expect(file.gcode).toContain('N20');
    });

    it('should handle skipNewLine option', () => {
      file.put('G0', true);
      file.put('X10', true);
      file.put('Y20');

      expect(file.gcode).toContain('G0 X10 Y20');
    });

    it('should ignore empty sections', () => {
      file.put('');
      file.put('   ');
      file.put('G0 X10');

      const lines = file.gcode.split('\n').filter((line) => line.trim());
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('G0 X10');
    });
  });

  describe('Manual flush', () => {
    it('should flush accumulated sections', () => {
      file.put('G0', true);
      file.put('X10', true);
      file.put('Y20', true);
      file.flush();

      expect(file.gcode).toContain('G0 X10 Y20');
    });

    it('should handle empty flush', () => {
      file.flush();
      expect(file.gcode).toBe('');
    });
  });
});
