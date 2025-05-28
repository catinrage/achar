// tests/lib/parser.test.ts
import { describe, it, expect } from 'vitest';
import { Parser } from '../../src/lib/parser';
import { DirectionEnum, StateEnum, PlanEnum } from '../../src/common/enums';

describe('Parser', () => {
  describe('constructor', () => {
    it('should create a parser instance with input text', () => {
      const input = "(0)@start_of_file";
      const parser = new Parser(input);
      expect(parser).toBeInstanceOf(Parser);
    });
  });

  describe('parse method', () => {
    it('should parse empty input as empty array', () => {
      const parser = new Parser('');
      const result = parser.parse();
      expect(result).toEqual([]);
    });

    it('should parse a simple event with no parameters', () => {
      const input = "(0)@start_of_file";
      const parser = new Parser(input);
      const result = parser.parse();
      
      expect(result.length).toBe(1);
      expect(result[0]._eventName).toBe('StartOfFile');
      expect(result[0]._index).toBe(0);
    });

    it('should parse an event with string parameters', () => {
      const input = `(0)@start_of_file
      program_number: '1234'
      part_name: 'TEST_PART'`;
      
      const parser = new Parser(input);
      const result = parser.parse();
      
      expect(result.length).toBe(1);
      expect(result[0]._eventName).toBe('StartOfFile');
      expect(result[0].program_number).toBe('1234');
      expect(result[0].part_name).toBe('TEST_PART');
    });

    it('should parse an event with numeric parameters', () => {
      const input = `(0)@start_of_file
      xpos: 100
      ypos: 50.5
      speed: 1000rpm`;
      
      const parser = new Parser(input);
      const result = parser.parse();
      
      expect(result.length).toBe(1);
      expect(result[0].xpos).toBe(100);
      expect(result[0].ypos).toBe(50.5);
      expect(result[0].speed).toBe(1000);
    });

    it('should parse an event with boolean parameters', () => {
      const input = `(0)@start_of_file
      rotate_used: true
      mirror_used: false`;
      
      const parser = new Parser(input);
      const result = parser.parse();
      
      expect(result.length).toBe(1);
      expect(result[0].rotate_used).toBe(true);
      expect(result[0].mirror_used).toBe(false);
    });

    it('should parse an event with enum parameters', () => {
      const input = `(0)@start_of_file
      direction: cw
      state: on
      plane: xy`;
      
      const parser = new Parser(input);
      const result = parser.parse();
      
      expect(result.length).toBe(1);
      expect(result[0].direction).toBe(DirectionEnum.CW);
      expect(result[0].state).toBe(StateEnum.ON);
      expect(result[0].plane).toBe(PlanEnum.XY);
    });

    it('should parse multiple events', () => {
      const input = `(0)@start_of_file
      program_number: '1234'
      
      (1)@setup
      setup_name: 'SETUP_1'
      
      (2)@end_of_file`;
      
      const parser = new Parser(input);
      const result = parser.parse();
      
      expect(result.length).toBe(3);
      expect(result[0]._eventName).toBe('StartOfFile');
      expect(result[1]._eventName).toBe('Setup');
      expect(result[2]._eventName).toBe('EndOfFile');
      
      expect(result[0].program_number).toBe('1234');
      expect(result[1].setup_name).toBe('SETUP_1');
    });
    
    it('should handle same-line key-value pairs', () => {
      const input = `(0)@start_of_file program_number: '1234' part_name: 'TEST_PART'`;
      
      const parser = new Parser(input);
      const result = parser.parse();
      
      expect(result.length).toBe(1);
      expect(result[0].program_number).toBe('1234');
      expect(result[0].part_name).toBe('TEST_PART');
    });
    
    it('should handle edge case values', () => {
      const input = `(0)@start_of_file
      empty_string: ''
      special_chars: '!@#$%^&*()_+'
      strange_value: something_undefined`;
      
      const parser = new Parser(input);
      const result = parser.parse();
      
      expect(result[0].empty_string).toBe('');
      expect(result[0].special_chars).toBe('!@#$%^&*()_+');
      expect(result[0].strange_value).toBe('something_undefined');
    });

    it('should parse a real-world example from file content', () => {
      // Sample content taken from one of the MPF files
      const input = `(0)@start_of_file
      build_revision: 33160
      program_number: '1'
      g_file_name: 'Setup1'
      full_g_file_name: 'C:\\Users\\User\\Documents\\SolidCAM\\2022\\SolidCAM 2022\\projects\\Test\\Setup1.gpp'
      part_name: 'Test'
      part_model_name: 'Test.SLDPRT'
      part_full_name: 'C:\\Users\\User\\Documents\\SolidCAM\\2022\\SolidCAM 2022\\projects\\Test'
      path_part: 'setup1'`;
      
      const parser = new Parser(input);
      const result = parser.parse();
      
      expect(result.length).toBe(1);
      expect(result[0]._eventName).toBe('StartOfFile');
      expect(result[0].build_revision).toBe(33160);
      expect(result[0].program_number).toBe('1');
      expect(result[0].g_file_name).toBe('Setup1');
      expect(result[0].part_name).toBe('Test');
      // Test other properties as needed
    });
  });

  describe('toPascalCase method', () => {
    // Although private, we can test it indirectly through the parse method
    it('should convert snake_case to PascalCase', () => {
      const input = `(0)@start_of_file
      (1)@end_of_file
      (2)@change_tool
      (3)@rapid_move`;
      
      const parser = new Parser(input);
      const result = parser.parse();
      
      expect(result[0]._eventName).toBe('StartOfFile');
      expect(result[1]._eventName).toBe('EndOfFile');
      expect(result[2]._eventName).toBe('ChangeTool');
      expect(result[3]._eventName).toBe('RapidMove');
    });
  });
  
  describe('Integration with MPF files', () => {
    // This test would be more complex and might require loading a real MPF file
    // It's provided as an example of a more comprehensive test
    it('should correctly parse a small sample MPF file', () => {
      const sampleMpf = `(0)@start_of_file
      build_revision: 33160
      program_number: '1'
      
      (1)@setup
      setup_name: 'Setup1'
      fixture_name: 'Fixture1'
      
      (2)@change_tool
      tool_number: 1
      tool_length: 100
      tool_diameter: 10
      
      (3)@rapid_move
      xpos: 0
      ypos: 0
      zpos: 100
      
      (4)@end_of_file`;
      
      const parser = new Parser(sampleMpf);
      const result = parser.parse();

      expect(result.length).toBe(5);
      
      // Check StartOfFile event
      expect(result[0]._eventName).toBe('StartOfFile');
      expect(result[0].build_revision).toBe(33160);
      
      // Check Setup event
      expect(result[1]._eventName).toBe('Setup');
      expect(result[1].setup_name).toBe('Setup1');
      
      // Check ChangeTool event
      expect(result[2]._eventName).toBe('ChangeTool');
      expect(result[2].tool_number).toBe(1);
      
      // Check RapidMove event
      expect(result[3]._eventName).toBe('RapidMove');
      expect(result[3].xpos).toBe(0);
      expect(result[3].ypos).toBe(0);
      expect(result[3].zpos).toBe(100);
      
      // Check EndOfFile event
      expect(result[4]._eventName).toBe('EndOfFile');
    });
  });
});