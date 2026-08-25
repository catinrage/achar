/**
 * Hand-built Trace 5 sources for the server integration tests.
 *
 * Small enough to keep `bun test` fast, complete enough that the
 * `siemens-828d` post generates real files from them — the repo's actual
 * fixtures are 8.7 MB to 67 MB and belong in the parity run, not here.
 */

/** A healthy one-setup program with machining time on its single job. */
export const TIMED_TRACE = `
(0)@start_of_file
part_name : 'DEMO_PART'
part_model_name : 'C:\\models\\demo.SLDPRT'
part_full_name : 'C:\\temp\\demo.prz'
user_account : 'ACHAR'
home_number : 54
VMID_file : 'Siemens_828D_Milling_4A'
program_number : 1000
imachining_material_name : 'Aluminum_120BHN-69HRB'
inch_system : 0
stock_type : 0
stock_x : 100.000
stock_y : 50.000
stock_z : 20.000
target_x : 90.000
target_y : 40.000
target_z : 15.000
(1)@setup
setup_name : 'Setup1'
fixture_name : 'Vise'
part_home_number : 1
(2)@def_tool
tool_id_string : 'END12Z3AL'
tool_name : 'EM12'
tool_type : 'end mill'
tool_diameter : 12.000
tool_number : 1
tool_teeth_number : 3
tool_work_time : '  0:03:44'
(3)@change_tool
tool_id_string : 'END12Z3AL'
tool_number : 1
(4)@start_of_job
job_name : 'iRough'
job_type : 'profile'
original_job_name : 'iRough'
job_time : '  0:02:00'
job_cutting_time : '  0:01:30'
job_linking_time : '  0:00:10'
xnext : 10.000
ynext : 20.000
znext : 5.000
spin_rate : 3000.000
spin_direction : cw
feed_rate : 500.000
used_in_transform_4x : 0
(5)@rapid_move
xpos : 10.000
ypos : 20.000
zpos : 5.000
(6)@line
xpos : 30.000
ypos : 20.000
zpos : -2.000
feed : 500
(7)@end_of_job
(8)@end_of_file
`;

/**
 * Parses cleanly, but contradicts itself: one job name starts twice with two
 * different `job_time` stamps. Repeats of a name are transform instances of a
 * single operation, which must share one total — so core refuses to guess
 * which stamp is real.
 */
export const CONTRADICTORY_REPEAT_TRACE = `
(0)@start_of_file
part_name : 'REPEAT_PART'
program_number : 3000
(1)@setup
setup_name : 'Setup1'
(2)@change_tool
tool_id_string : 'DRILL6'
(3)@start_of_job
job_name : 'DRILL6D'
job_time : '  0:01:40'
(4)@start_of_job
job_name : 'DRILL6D'
job_time : '  0:02:00'
(5)@end_of_file
`;

/**
 * The PROJECT_2551019 shape: posted without SolidCAM time estimation, so it
 * is structurally valid but every duration is blank or zero.
 */
export const UNTIMED_TRACE = `
(0)@start_of_file
part_name : 'UNTIMED_PART'
program_number : 2000
(1)@setup
setup_name : 'Setup1'
(2)@def_tool
tool_id_string : 'END6Z4'
tool_work_time : '  0:00:00'
(3)@change_tool
tool_id_string : 'END6Z4'
(4)@start_of_job
job_name : 'iRough'
job_time : ''
(5)@end_of_file
`;

/**
 * Two setups, each loading a tool the other does not.
 *
 * The smallest trace that can tell a whole-part post from a narrowed one: the
 * distinct tools make a pruned tool table visible in the output, and the
 * `@end_program` gives the partition a real epilogue to keep.
 */
export const TWO_SETUP_TRACE = `
(0)@start_of_file
part_name : 'TWO_SETUPS'
home_number : 54
program_number : 4000
inch_system : 0
(1)@def_tool
tool_id_string : 'END12Z3AL'
tool_name : 'EM12'
tool_type : 'end mill'
tool_diameter : 12.000
tool_number : 1
tool_teeth_number : 3
tool_work_time : '  0:02:00'
(2)@def_tool
tool_id_string : 'DRILL6'
tool_name : 'D6'
tool_type : 'drill'
tool_diameter : 6.000
tool_number : 2
tool_teeth_number : 2
tool_work_time : '  0:01:00'
(3)@setup
setup_name : 'Front'
fixture_name : 'Vise'
part_home_number : 1
(4)@change_tool
tool_id_string : 'END12Z3AL'
tool_number : 1
(5)@start_of_job
job_name : 'iRough'
job_type : 'profile'
original_job_name : 'iRough'
job_time : '  0:02:00'
job_cutting_time : '  0:01:30'
job_linking_time : '  0:00:10'
xnext : 10.000
ynext : 20.000
znext : 5.000
spin_rate : 3000.000
spin_direction : cw
feed_rate : 500.000
used_in_transform_4x : 0
(6)@rapid_move
xpos : 10.000
ypos : 20.000
zpos : 5.000
(7)@line
xpos : 30.000
ypos : 20.000
zpos : -2.000
feed : 500
(8)@end_of_job
(9)@setup
setup_name : 'Back'
fixture_name : 'Vise'
part_home_number : 2
(10)@change_tool
tool_id_string : 'DRILL6'
tool_number : 2
(11)@start_of_job
job_name : 'Drill'
job_type : 'profile'
original_job_name : 'Drill'
job_time : '  0:01:00'
job_cutting_time : '  0:00:45'
job_linking_time : '  0:00:05'
xnext : 40.000
ynext : 25.000
znext : 5.000
spin_rate : 2000.000
spin_direction : cw
feed_rate : 200.000
used_in_transform_4x : 0
(12)@rapid_move
xpos : 40.000
ypos : 25.000
zpos : 5.000
(13)@line
xpos : 40.000
ypos : 25.000
zpos : -3.000
feed : 200
(14)@end_of_job
(15)@end_program
(16)@end_of_file
`;
