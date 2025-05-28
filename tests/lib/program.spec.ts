// tests/lib/program.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { Program } from '../../src/lib/program';
import type { EventListener } from '../../src/lib/program';
import { Builder } from '../../src/lib/builder';
import { DirectionEnum } from '../../src/common/enums';
import type { EventData } from '../../src/lib/parser';
import type { EventsType } from '../../src/types';

// Mock Builder implementation for testing
vi.mock('../../src/lib/builder', () => {
  return {
    Builder: vi.fn().mockImplementation(() => {
      return {
        put: vi.fn(),
        flush: vi.fn(),
        gcode: 'N10 G0 X0 Y0 Z0\nN20 G1 X10 Y10 Z10',
        Rapid: vi.fn(),
        Line: vi.fn(),
        SetSpindleSpeed: vi.fn(),
        SetSpindleDirection: vi.fn(),
      };
    }),
  };
});

describe('Program', () => {
  let program: Program;
  
  beforeEach(() => {
    vi.clearAllMocks();
    program = new Program();
  });
  
  describe('constructor', () => {
    it('should create a new Program instance', () => {
      expect(program).toBeInstanceOf(Program);
    });
    
    it('should initialize with empty events and listeners', () => {
      expect(program.listEvents()).toEqual([]);
    });
  });
  
  describe('loadEvents', () => {
    it('should load events from EventData array', () => {
      const mockEventData: EventData[] = [
        {
          _eventName: 'StartOfFile' as keyof EventsType,
          _index: 0,
          program_number: '1234',
          part_name: 'TEST_PART',
        },
        {
          _eventName: 'ChangeTool' as keyof EventsType,
          _index: 1,
          tool_number: 1,
          tool_diameter: 10,
        },
        {
          _eventName: 'EndOfFile' as keyof EventsType,
          _index: 2,
        },
      ];
      
      program.loadEvents(mockEventData);
      
      // Check that events were loaded correctly
      const eventNames = program.listEvents();
      expect(eventNames).toEqual(['StartOfFile', 'ChangeTool', 'EndOfFile']);
      expect(eventNames.length).toBe(3);
    });
    
    it('should handle empty EventData array', () => {
      program.loadEvents([]);
      expect(program.listEvents()).toEqual([]);
    });
    
    it('should convert EventData to internal Event objects correctly', () => {
      const mockEventData: EventData[] = [
        {
          _eventName: 'MFeedSpin' as keyof EventsType,
          _index: 0,
          feed: 100,
          spin: 1000,
          spin_direction: DirectionEnum.CW,
        },
      ];
      
      // Set up a listener to verify the event data is passed correctly
      const mockListener = vi.fn();
      program.on('MFeedSpin', mockListener);
      
      // Load and process the event
      program.loadEvents(mockEventData);
      program.process();
      
      // Check that the listener was called with the correct data
      expect(mockListener).toHaveBeenCalledTimes(1);
      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          feed: 100,
          spin: 1000,
          spin_direction: DirectionEnum.CW,
        }),
        expect.any(Object)
      );
    });
  });
  
  describe('on method', () => {
    it('should register an event listener', () => {
      const listener: EventListener<'RapidMove'> = vi.fn();
      program.on('RapidMove', listener);
      
      // Trigger the event
      program.trigger('RapidMove', { xpos: 10, ypos: 20, zpos: 30 });
      
      // Check that the listener was called
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ xpos: 10, ypos: 20, zpos: 30 }),
        expect.any(Object)
      );
    });
    
    it('should allow multiple listeners for the same event', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      
      program.on('RapidMove', listener1);
      program.on('RapidMove', listener2);
      
      program.trigger('RapidMove', { xpos: 10, ypos: 20, zpos: 30 });
      
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
    
    it('should maintain listener execution order', () => {
      const executionOrder: number[] = [];
      
      program.on('RapidMove', () => executionOrder.push(1));
      program.on('RapidMove', () => executionOrder.push(2));
      program.on('RapidMove', () => executionOrder.push(3));
      
      program.trigger('RapidMove', { xpos: 10, ypos: 20, zpos: 30 });
      
      expect(executionOrder).toEqual([1, 2, 3]);
    });
  });
  
  describe('off method', () => {
    it('should remove a registered listener', () => {
      const listener = vi.fn();
      
      program.on('RapidMove', listener);
      program.trigger('RapidMove', { xpos: 10, ypos: 20, zpos: 30 });
      expect(listener).toHaveBeenCalledTimes(1);
      
      // Remove the listener
      program.off('RapidMove', listener);
      program.trigger('RapidMove', { xpos: 40, ypos: 50, zpos: 60 });
      
      // Should still be called only once (from the first trigger)
      expect(listener).toHaveBeenCalledTimes(1);
    });
    
    it('should only remove the specified listener', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      
      program.on('RapidMove', listener1);
      program.on('RapidMove', listener2);
      
      program.off('RapidMove', listener1);
      program.trigger('RapidMove', { xpos: 10, ypos: 20, zpos: 30 });
      
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });
    
    it('should handle non-existent event names gracefully', () => {
      const listener = vi.fn();
      // This should not throw an error
      expect(() => program.off('NonExistentEvent' as keyof EventsType, listener)).not.toThrow();
    });
    
    it('should handle non-existent listeners gracefully', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      
      program.on('RapidMove', listener1);
      
      // This should not throw an error
      expect(() => program.off('RapidMove', listener2)).not.toThrow();
      
      // The original listener should still work
      program.trigger('RapidMove', { xpos: 10, ypos: 20, zpos: 30 });
      expect(listener1).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('trigger method', () => {
    it('should trigger all registered listeners for an event', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      
      program.on('Line', listener1);
      program.on('Line', listener2);
      
      program.trigger('Line', { xpos: 10, ypos: 20, zpos: 30 });
      
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
    
    it('should pass event parameters to listeners', () => {
      const listener = vi.fn();
      program.on('ChangeTool', listener);
      
      const toolParams = {
        tool_number: 5,
        tool_diameter: 10,
        spindle_position: 1
      };
      
      program.trigger('ChangeTool', toolParams);
      
      expect(listener).toHaveBeenCalledWith(toolParams, expect.any(Object));
    });
    
    it('should handle no registered listeners gracefully', () => {
      // This should not throw an error
      expect(() => program.trigger('RapidMove', { xpos: 10, ypos: 20, zpos: 30 })).not.toThrow();
    });
    
    it('should pass the Builder instance to listeners', () => {
      const listener = vi.fn();
      program.on('RapidMove', listener);
      
      program.trigger('RapidMove', { xpos: 10, ypos: 20, zpos: 30 });
      
      // Check that the second argument to the listener is a Builder instance
      expect(listener.mock.calls[0][1]).toEqual(expect.objectContaining({
        put: expect.any(Function),
        flush: expect.any(Function),
        gcode: expect.any(String),
        Rapid: expect.any(Function),
        Line: expect.any(Function),
        SetSpindleSpeed: expect.any(Function),
        SetSpindleDirection: expect.any(Function)
      }));
    });
    
    it('should allow partial event parameters', () => {
      const listener = vi.fn();
      program.on('RapidMove', listener);
      
      // Only provide xpos
      program.trigger('RapidMove', { xpos: 10 });
      
      expect(listener).toHaveBeenCalledWith({ xpos: 10 }, expect.any(Object));
    });
  });
  
  describe('listEvents method', () => {
    it('should return an empty array when no events are loaded', () => {
      expect(program.listEvents()).toEqual([]);
    });
    
    it('should return all loaded event names', () => {
      const mockEventData: EventData[] = [
        { _eventName: 'StartOfFile' as keyof EventsType, _index: 0 },
        { _eventName: 'ChangeTool' as keyof EventsType, _index: 1 },
        { _eventName: 'EndOfFile' as keyof EventsType, _index: 2 },
      ];
      
      program.loadEvents(mockEventData);
      expect(program.listEvents()).toEqual(['StartOfFile', 'ChangeTool', 'EndOfFile']);
    });
  });
  
  describe('process method', () => {
    it('should process all loaded events in order', () => {
      const mockEventData: EventData[] = [
        { _eventName: 'StartOfFile' as keyof EventsType, _index: 0 },
        { _eventName: 'ChangeTool' as keyof EventsType, _index: 1 },
        { _eventName: 'EndOfFile' as keyof EventsType, _index: 2 },
      ];
      
      const startListener = vi.fn();
      const changeListener = vi.fn();
      const endListener = vi.fn();
      
      program.on('StartOfFile', startListener);
      program.on('ChangeTool', changeListener);
      program.on('EndOfFile', endListener);
      
      program.loadEvents(mockEventData);
      program.process();
      
      expect(startListener).toHaveBeenCalledTimes(1);
      expect(changeListener).toHaveBeenCalledTimes(1);
      expect(endListener).toHaveBeenCalledTimes(1);
      
      // Check execution order
      expect(startListener.mock.invocationCallOrder[0])
        .toBeLessThan(changeListener.mock.invocationCallOrder[0]);
      expect(changeListener.mock.invocationCallOrder[0])
        .toBeLessThan(endListener.mock.invocationCallOrder[0]);
    });
    
    it('should do nothing if no events are loaded', () => {
      const listener = vi.fn();
      program.on('StartOfFile', listener);
      
      program.process();
      
      expect(listener).not.toHaveBeenCalled();
    });
    
    it('should work with complex event parameters', () => {
      const mockEventData: EventData[] = [
        {
          _eventName: 'MFeedSpin' as keyof EventsType,
          _index: 0,
          feed: 100,
          feed_unit: 'mm/min',
          spin: 1000,
          spin_unit: 'RPM',
          spin_direction: DirectionEnum.CW
        }
      ];
      
      const listener = vi.fn();
      program.on('MFeedSpin', listener);
      
      program.loadEvents(mockEventData);
      program.process();
      
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          feed: 100,
          feed_unit: 'mm/min',
          spin: 1000,
          spin_unit: 'RPM',
          spin_direction: DirectionEnum.CW
        }),
        expect.any(Object)
      );
    });
  });
  
  describe('generate method', () => {
    it('should call flush on the Builder and return its gcode', () => {
      // Mock the Builder instance
      const mockBuilderInstance = {
        put: vi.fn(),
        flush: vi.fn(),
        gcode: 'N10 G0 X0 Y0 Z0\nN20 G1 X10 Y10 Z10',
        Rapid: vi.fn(),
        Line: vi.fn(),
        SetSpindleSpeed: vi.fn(),
        SetSpindleDirection: vi.fn(),
      };

      // Override the mock implementation to return the mockBuilderInstance
      (Builder as unknown as Mock).mockImplementation(() => mockBuilderInstance);

      // Reset the program to use the new mock
      program = new Program();

      // Register event listeners
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

      // Trigger events
      program.trigger('RapidMove', { xpos: 0, ypos: 0, zpos: 0 });
      program.trigger('Line', { xpos: 10, ypos: 10, zpos: 10 });

      // Generate the G-code
      const result = program.generate();

      // Verify that flush was called
      expect(mockBuilderInstance.flush).toHaveBeenCalledTimes(1);

      // Verify the returned G-code
      expect(result).toBe('N10 G0 X0 Y0 Z0\nN20 G1 X10 Y10 Z10');
    });
  });
  
  describe('Integration tests', () => {
    it('should properly handle a complete workflow', () => {
      // Mock the Builder instance
      const mockBuilderInstance = {
        put: vi.fn(),
        flush: vi.fn(),
        gcode: 'N10 G0 X0 Y0 Z0\nN20 G1 X10 Y10 Z10',
        Rapid: vi.fn(),
        Line: vi.fn(),
        SetSpindleSpeed: vi.fn(),
        SetSpindleDirection: vi.fn(),
      };

      // Override the mock implementation to return the mockBuilderInstance
      (Builder as unknown as Mock).mockImplementation(() => mockBuilderInstance);

      // Reset the program to use the new mock
      program = new Program();

      // Create mock events
      const mockEventData: EventData[] = [
        {
          _eventName: 'StartOfFile' as keyof EventsType,
          _index: 0,
          program_number: '1234',
        },
        {
          _eventName: 'ChangeTool' as keyof EventsType,
          _index: 1,
          tool_number: 1,
          tool_diameter: 10,
        },
        {
          _eventName: 'RapidMove' as keyof EventsType,
          _index: 2,
          xpos: 0,
          ypos: 0,
          zpos: 100,
        },
        {
          _eventName: 'EndOfFile' as keyof EventsType,
          _index: 3,
        },
      ];

      // Create mock listeners
      const startListener = vi.fn();
      const toolListener = vi.fn((params, builder) => {
        builder.SetSpindleSpeed(1000);
      });
      const rapidListener = vi.fn((params, builder) => {
        builder.Rapid({
          x: params.xpos,
          y: params.ypos,
          z: params.zpos,
        });
      });
      const endListener = vi.fn();

      // Register listeners
      program.on('StartOfFile', startListener);
      program.on('ChangeTool', toolListener);
      program.on('RapidMove', rapidListener);
      program.on('EndOfFile', endListener);

      // Load and process events
      program.loadEvents(mockEventData);
      program.process();
      const gcode = program.generate();

      // Verify all listeners were called
      expect(startListener).toHaveBeenCalledTimes(1);
      expect(toolListener).toHaveBeenCalledTimes(1);
      expect(rapidListener).toHaveBeenCalledTimes(1);
      expect(endListener).toHaveBeenCalledTimes(1);

      // Verify Builder methods were called with correct parameters
      expect(mockBuilderInstance.SetSpindleSpeed).toHaveBeenCalledWith(1000);
      expect(mockBuilderInstance.Rapid).toHaveBeenCalledWith({
        x: 0,
        y: 0,
        z: 100,
      });
      expect(mockBuilderInstance.flush).toHaveBeenCalledTimes(1);

      // Verify the G-code output
      expect(gcode).toBe('N10 G0 X0 Y0 Z0\nN20 G1 X10 Y10 Z10');
    });
    
    it('should allow manual event triggering outside of process()', () => {
      // Mock the Builder instance
      const mockBuilderInstance = {
        put: vi.fn(),
        flush: vi.fn(),
        gcode: 'N10 G0 X0 Y0 Z0\nN20 G1 X10 Y10 Z10',
        Rapid: vi.fn(),
        Line: vi.fn(),
        SetSpindleSpeed: vi.fn(),
        SetSpindleDirection: vi.fn(),
      };

      // Override the mock implementation to return the mockBuilderInstance
      (Builder as unknown as Mock).mockImplementation(() => mockBuilderInstance);

      // Reset the program to use the new mock
      program = new Program();

      const rapidListener = vi.fn((params, builder) => {
        builder.Rapid({
          x: params.xpos,
          y: params.ypos,
          z: params.zpos,
        });
      });

      program.on('RapidMove', rapidListener);

      // Manually trigger an event
      program.trigger('RapidMove', {
        xpos: 50,
        ypos: 60,
        zpos: 70,
      });

      expect(rapidListener).toHaveBeenCalledTimes(1);
      expect(mockBuilderInstance.Rapid).toHaveBeenCalledWith({
        x: 50,
        y: 60,
        z: 70,
      });
    });
    
    it('should handle multiple listeners for the same event type', () => {
      const mockEventData: EventData[] = [
        {
          _eventName: 'RapidMove' as keyof EventsType,
          _index: 0,
          xpos: 10,
          ypos: 20,
          zpos: 30,
        }
      ];
      
      const countCalls = { count: 0 };
      
      // First listener increments a counter
      const listener1 = vi.fn(() => {
        countCalls.count += 1;
      });
      
      // Second listener checks the counter value
      const listener2 = vi.fn(() => {
        expect(countCalls.count).toBe(1); // Should be 1 because listener1 ran first
      });
      
      program.on('RapidMove', listener1);
      program.on('RapidMove', listener2);
      
      program.loadEvents(mockEventData);
      program.process();
      
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(countCalls.count).toBe(1);
    });
  });
  
  describe('Error handling', () => {
    it('should handle errors in event listeners gracefully', () => {
      // Register a listener that throws an error
      const errorListener = vi.fn(() => {
        throw new Error('Test error');
      });
      
      program.on('RapidMove', errorListener);
      
      // This should throw but we can test that it doesn't crash the program
      expect(() => {
        program.trigger('RapidMove', { xpos: 10, ypos: 20, zpos: 30 });
      }).toThrow('Test error');
    });
  });
});