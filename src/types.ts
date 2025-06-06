import type { DirectionEnum, PlanEnum, StateEnum } from './common/enums';

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object
    ? T[P] extends Function
      ? T[P]
      : DeepPartial<T[P]>
    : T[P];
};

export type EventsType = {
  StartOfFile: {
    build_revision: number;
    program_number: number;
    g_file_name: string;
    full_g_file_name: string;
    part_name: string;
    part_model_name: string;
    part_full_name: string;
    path_part: string;
    index_split_file: number;
    split_name: string;
    ChannelID: number;
    total_channels: number;
    VMID_file: string;
    Sync_Data_Name: string;
    supported_CAM_Modules: string;
    Module_MI5: number;
    Module_MI4: number;
    Module_MS4: number;
    Module_MS5X_5: number;
    Module_MS5X_4: number;
    Module_MS5X_3: number;
    Module_Con5X: number;
    Module_5XDrill: number;
    Module_Multi_Turret: number;
    Module_MS5X_MSim: number;
    Module_T: number;
    Module_XYZC: number;
    Module_XYZCB: number;
    Module_BS: number;
    rotate_used: boolean;
    mirror_used: boolean;
    fourth_axis_used: boolean;
    inch_system: number;
    user_account: string;
    home_number: number;
    home_changed: boolean;
    clearance_plane: number;
    tool_start_plane: number;
    work_upper_plane: number;
    zero_plane: number;
    stock_x_plus: number;
    stock_y_plus: number;
    stock_z_plus: number;
    stock_x_minus: number;
    stock_y_minus: number;
    stock_z_minus: number;
    stock_x: number;
    stock_y: number;
    stock_z: number;
    target_x_plus: number;
    target_y_plus: number;
    target_z_plus: number;
    target_x_minus: number;
    target_y_minus: number;
    target_z_minus: number;
    target_x: number;
    target_y: number;
    target_z: number;
    stock_type: number;
    submachine_ID: number;
    submachine_name: string;
    submachine_gpp_name: string;
    imachining_material_name: string;
  };
  VmidInfo: {
    vmid_item_id: number;
    vmid_item_name: string;
    vmid_item_type: string;
    vmid_origin_x: number;
    vmid_origin_y: number;
    vmid_origin_z: number;
    vmid_x_i: number;
    vmid_x_j: number;
    vmid_x_k: number;
    vmid_y_i: number;
    vmid_y_j: number;
    vmid_y_k: number;
    vmid_z_i: number;
    vmid_z_j: number;
    vmid_z_k: number;
  };
  DefTool: {
    tool_number: number;
    tool_tag: number;
    part_tool_tag: number;
    tool_offset: number;
    tool_tip_radius: number;
    tool_position_in_turret: number;
    tool_position: string;
    tool_string_index: string;
    spindle_position: number;
    tool_length: number;
    tool_teeth_number: number;
    corner_radius: number;
    tool_feed: number;
    tool_spin: number;
    tool_direction: DirectionEnum;
    tool_message: string;
    tool_type: string;
    tool_feed_z: number;
    tool_feed_finish: number;
    tool_spin_finish: number;
    tool_id_number: number;
    cutting_point_ID: number;
    measure_orientation: number;
    tool_id_string: string;
    tool_angle: number;
    d_offset: number;
    h_offset: number;
    user_tool_offset: number;
    tool_user_type: string;
    string_tool_type: string;
    tool_rough: number;
    tool_drill_lead: number;
    tool_name: string;
    holder_name: string;
    tool_description: string;
    holder_description: string;
    total_tool_length: number;
    cutting_tool_length: number;
    hlength: number;
    tool_diameter: number;
    arbor_diameter: number;
    shoulder_length: number;
    msg_mill_tool1: string;
    msg_mill_tool2: string;
    msg_mill_tool3: string;
    msg_mill_tool4: string;
    msg_mill_tool5: string;
    TurretName: string;
    turret_number: number;
    tool_used_in_main_spindle: number;
    tool_used_in_back_spindle: number;
    number_occur_of_tool: number;
    tool_work_time: string;
    msr_len: string;
    msr_rad: string;
    tolerance_len: number;
    tolerance_rad: number;
    Tool_holder_mount_x: number;
    Tool_holder_mount_y: number;
    Tool_holder_mount_z: number;
    mounting_direction_x: number;
    mounting_direction_y: number;
    mounting_direction_z: number;
    used_as_compensated: number;
    manual_change: number;
    keep_empty_pocket: number;
    multi_tool_pos: number;
  };
  AbsoluteMode: {};
  MachinePlane: {
    machine_plane: PlanEnum;
  };
  StartProgram: {
    xpos: number;
    ypos: number;
    zpos: number;
    distance_from_home1: number;
    start_with_part_in_sub: boolean;
    single_piece: string;
    stock_name: string;
    target_name: string;
    target_configuration_name: string;
    ChannelID: number;
    ChannelName: string;
    submachine_ID: number;
  };
  Setup: {
    setup_name: string;
    submachine_ID: number;
    submachine_name: string;
    submachine_gpp_name: string;
    part_home_number: number;
    mac_number: number;
    fixture_name: string;
    stock_in: number;
    machine_offset_x: number;
    machine_offset_y: number;
    machine_offset_z: number;
    setup_shift_from_MCS_x: number;
    setup_shift_from_MCS_y: number;
    setup_shift_from_MCS_z: number;
    fixture_x_min: number;
    fixture_y_min: number;
    fixture_z_min: number;
    fixture_x_max: number;
    fixture_y_max: number;
    fixture_z_max: number;
    fixturerotdir: string;
    setup_fixture_rotation: number;
    name_extr_axis_L1: string;
    name_extr_axis_L2: string;
    name_extr_axis_L3: string;
    name_extr_axis_R1: string;
    name_extr_axis_R2: string;
    name_extr_axis_R3: string;
    move_extr_axis_L1: number;
    move_extr_axis_L2: number;
    move_extr_axis_L3: number;
    move_extr_axis_R1: number;
    move_extr_axis_R2: number;
    move_extr_axis_R3: number;
    part_pos_in_setup_x: number;
    part_pos_in_setup_y: number;
    part_pos_in_setup_z: number;
    fixture_pos_in_setup_x: number;
    fixture_pos_in_setup_y: number;
    fixture_pos_in_setup_z: number;
  };
  HomeNumber: {
    home_number: number;
    home_user_name: string;
  };
  ChangeTool: {
    tool_number: number;
    tool_tag: number;
    part_tool_tag: number;
    tool_position_in_turret: number;
    tool_position: string;
    tool_string_index: string;
    spindle_position: number;
    tool_type: string;
    tool_tip_radius: number;
    tool_id_number: number;
    cutting_point_ID: number;
    measure_orientation: number;
    tool_id_string: string;
    tool_length: number;
    tool_teeth_number: number;
    corner_radius: number;
    tool_angle: number;
    tool_offset: number;
    tool_feed: number;
    feed_teeth: number;
    tool_spin: number;
    spin_teeth: number;
    tool_feed_z: number;
    tool_feed_finish: number;
    tool_spin_finish: number;
    tool_first_feed: number;
    tool_first_spin: number;
    submachine_ID: number;
    submachine_name: string;
    submachine_gpp_name: string;
    tool_first_direction: DirectionEnum;
    tool_first_feed_unit: number;
    tool_first_spin_unit: number;
    tool_message: string;
    tool_user_type: string;
    string_tool_type: string;
    tool_rough: number;
    first_tool: boolean;
    last_tool: boolean;
    last_last_tool: boolean;
    job_name: string;
    original_job_name: string;
    job_type: string;
    xtool: number;
    ytool: number;
    ztool: number;
    tool_change_position_mode: number;
    axes_order: string;
    xmtool: number;
    ymtool: number;
    zmtool: number;
    xnext: number;
    ynext: number;
    znext: number;
    cnext: number;
    xhnext: number;
    yhnext: number;
    zhnext: number;
    next_tool_number: number;
    next_tool_tag: number;
    next_tool_id_number: number;
    next_tool_id_number_on_turret: number;
    next_tool_id_string: string;
    next_tool_id_string_on_turret: string;
    next_tool_machine_type: string;
    next_next_tool_number: number;
    next_tool_in_turret: number;
    next_part_tool_tag: number;
    next_tool_tag_on_turret: number;
    next_part_tool_tag_on_turret: number;
    number_of_jobs_used_tool: number;
    number_occur_of_tool: number;
    appearance_of_tool: number;
    num_oper_in_appear: number;
    user_tool_offset: number;
    tool_change_type: string;
    tool_direction: DirectionEnum;
    spin_direction: DirectionEnum;
    table_tool_direction: DirectionEnum;
    spin: number;
    finish_spin: number;
    spin_finish_teeth: number;
    mill_pivot_length: number;
    tool_drill_lead: number;
    tool_name: string;
    holder_name: string;
    tool_description: string;
    holder_description: string;
    total_tool_length: number;
    cutting_tool_length: number;
    hlength: number;
    tool_diameter: number;
    arbor_diameter: number;
    shoulder_length: number;
    msg_mill_tool1: string;
    msg_mill_tool2: string;
    msg_mill_tool3: string;
    msg_mill_tool4: string;
    msg_mill_tool5: string;
    d_offset: number;
    h_offset: number;
    spindle: string;
    TurretName: string;
    turret_number: number;
    tool_used_in_main_spindle: number;
    tool_used_in_back_spindle: number;
    msr_len: string;
    msr_rad: string;
    Tool_holder_mount_x: number;
    Tool_holder_mount_y: number;
    Tool_holder_mount_z: number;
    drive_unit_gear_ID: number;
    gear_min_spin: number;
    gear_max_spin: number;
    Slave_Drive_Unit: number;
    manual_change: number;
    keep_empty_pocket: number;
    force_tool_change: number;
    tool_change_forced: number;
    multi_tool_pos: number;
  };
  OffsetChange: {
    d_offset: number;
    h_offset: number;
    cutting_point_ID: number;
    measure_orientation: number;
    tool_position: string;
    tool_string_index: string;
    xtool: number;
    ytool: number;
    ztool: number;
    xmtool: number;
    ymtool: number;
    zmtool: number;
  };
  StartOfJob: {
    job_name: string;
    original_job_name: string;
    job_type: string;
    next_job_type_name: string;
    next_job_machine_type_on_turret: string;
    next_job_type_name_on_turret: string;
    next_job_submachine_ID_on_turret: number;
    groove_type_cut_off: number;
    geom_name: string;
    home_user_name: string;
    check_z_minus: number;
    radial_direction: number;
    job_machine_type: string;
    prev_job_mac_type: string;
    use_cycle: boolean;
    machine_plane: PlanEnum;
    omachine_plane: string;
    xnext: number;
    ynext: number;
    znext: number;
    xhnext: number;
    yhnext: number;
    zhnext: number;
    TurretName: string;
    turret_number: number;
    target_name: string;
    stock_name: string;
    ChannelID: number;
    ChannelName: string;
    safety: number;
    compensation: boolean;
    mill_pivot_length: number;
    max_spin: number;
    msg: string;
    used_in_transform_4x: number;
    used_in_transform_mirror: number;
    used_in_transform_translate: number;
    used_in_transform_coordsys: number;
    used_in_transform_rotate: number;
    HSM_job: number;
    X5_job: number;
    thread_index_job: string;
    feed_unit: string;
    feed_status: string;
    spin_unit: string;
    depth: number;
    down_step: number;
    finish_down_step: number;
    job_clearance_plane: number;
    job_upper_plane: number;
    job_lower_plane: number;
    job_start_level: number;
    spindle: string;
    feed_rate: number;
    feed_teeth: number;
    finish_feed: number;
    feed_finish_teeth: number;
    feed_link: number;
    feed_link_teeth: number;
    feed_rapid: number;
    feed_rapid_teeth: number;
    z_feed: number;
    feed_z_teeth: number;
    spin_rate: number;
    spin_teeth: number;
    rest_material_feed: number;
    rest_material_feed_teeth: number;
    finish_spin: number;
    spin_finish_teeth: number;
    next_job_machine_type: string;
    next_job_tool_number: number;
    next_job_tool_id_number: number;
    next_job_tool_tag: number;
    next_job_tool_id_string: string;
    job_d_offset: number;
    job_h_offset: number;
    cutting_diameter: number;
    clear_offset_type: DirectionEnum;
    clear_offset: number;
    check_clear_offset: number;
    depth_type: string;
    profile_approach_type: string;
    approach_value: number;
    approach_tangent_value: number;
    approach_arc_angle: number;
    approach_arc_from_type: number;
    approach_arc_from_distance: number;
    profile_retreat_type: string;
    retreat_value: number;
    retreat_tangent_value: number;
    retreat_arc_angle: number;
    retreat_arc_from_type: number;
    retreat_arc_from_distance: number;
    offset_number: number;
    tool_offset: number;
    offset_radius: number;
    tool_side: string;
    slot_zigzag: number;
    is_chamfer: number;
    wall_draft_angle: number;
    feed_lead_in_percent: number;
    feed_lead_out_percent: number;
    wall_offset: number;
    floor_offset: number;
    complete_z_level: number;
    job_time: string;
    job_cutting_time: string;
    job_linking_time: string;
    index_job: number;
    submachine_ID: number;
    submachine_name: string;
    submachine_gpp_name: string;
    next_submachine_ID: number;
    next_submachine_name: string;
    next_submachine_gpp_name: string;
    rot_axis_type: string;
    rot_axis_coord: string;
    next_job5x: number;
    next_job_hsm: number;
    next_rot_axis_coord: string;
    next_rot_axis_type: string;
    flood_coolant: StateEnum;
    HP_flood_coolant: string;
    LP_flood_coolant: string;
    flood_ival_coolant: string;
    flood_coolant_val: number;
    mist_coolant: string;
    HP_mist_coolant: string;
    LP_mist_coolant: string;
    mist_ival_coolant: string;
    mist_coolant_val: number;
    through_coolant: string;
    HP_through_coolant: string;
    LP_through_coolant: string;
    MP_through_coolant: string;
    through_ival_coolant: string;
    through_coolant_val: number;
    air_blast_coolant: string;
    air_through_coolant: string;
    minimum_quantity_L: string;
    minimum_quantity_L_val: number;
    mach_flood_coolant: string;
    mach_HP_flood_coolant: string;
    mach_LP_flood_coolant: string;
    mach_flood_ival_coolant: string;
    mach_flood_coolant_val: number;
    mach_mist_coolant: string;
    mach_HP_mist_coolant: string;
    mach_LP_mist_coolant: string;
    mach_mist_ival_coolant: string;
    mach_mist_coolant_val: number;
    mach_active_air_coolant: string;
    mach_bed_rinsing_coolant: string;
    mach_shower_coolant: string;
    mach_HP_shower_coolant: string;
    mach_LP_shower_coolant: string;
    mach_shower_ival_coolant: string;
    mach_shower_coolant_val: number;
    Tool_holder_mount_x: number;
    Tool_holder_mount_y: number;
    Tool_holder_mount_z: number;
    drive_unit_gear_ID: number;
    gear_min_spin: number;
    gear_max_spin: number;
    Slave_Drive_Unit: number;
    user_tool_offset: number;
    tool_direction: DirectionEnum;
    spin_direction: DirectionEnum;
    arc_approximate: number;
    interpolation_for_distance: number;
    manual_change: number;
    keep_empty_pocket: number;
    tool_tag: number;
    part_tool_tag: number;
    tool_first_feed: number;
    tool_first_spin: number;
    tool_first_direction: DirectionEnum;
  };
  JobPlane: {
    job_plane: PlanEnum;
  };
  Message: {
    message: string;
  };
  MFeedSpin: {
    feed_unit: string;
    feed: number;
    feed_status: string;
    feed_teeth: number;
    spin_direction: DirectionEnum;
    spin_unit: string;
    spin: number;
    drive_unit_gear_ID: number;
    gear_min_spin: number;
    gear_max_spin: number;
    Slave_Drive_Unit: number;
    spin_teeth: number;
    feed_type: string;
  };
  Line: {
    xpos: number;
    ypos: number;
    zpos: number;
    feed: number;
    feed_teeth: number;
    spin: number;
    xhpos: number;
    yhpos: number;
    zhpos: number;
    next_direction: number;
    feed_type: string;
    i_CA: number;
    i_radius_curvature: number;
    i_radius_curvature_dir: number;
    i_temp_conventional: number;
    i_feed_no_curv: number;
  };
  Arc: {
    xpos: number;
    ypos: number;
    zpos: number;
    feed: number;
    feed_teeth: number;
    spin: number;
    arc_direction: number;
    radius: number;
    xcenter: number;
    ycenter: number;
    arc_plane: number;
    next_direction: number;
    start_angle: number;
    end_angle: number;
    arc_size: number;
    xcenter_rel: number;
    ycenter_rel: number;
    zstart: number;
    feed_type: string;
    arc_feed: number;
    xhpos: number;
    yhpos: number;
    zhpos: number;
    xhcenter: number;
    yhcenter: number;
    zhcenter: number;
    xhstart: number;
    yhstart: number;
    zhstart: number;
    xhcenter_rel: number;
    yhcenter_rel: number;
    zhcenter_rel: number;
    arc_plane_h: number;
    arc_direction_h: number;
    start_angle_h: number;
    end_angle_h: number;
    i_CA: number;
    i_radius_curvature: number;
    i_radius_curvature_dir: number;
    i_temp_conventional: number;
    i_feed_no_curv: number;
  };
  RapidMove: {
    xpos: number;
    ypos: number;
    zpos: number;
    xhpos: number;
    yhpos: number;
    zhpos: number;
    next_direction: number;
  };
  EndOfJob: {
    flood_coolant: StateEnum;
    HP_flood_coolant: string;
    LP_flood_coolant: string;
    flood_ival_coolant: string;
    flood_coolant_val: number;
    mist_coolant: string;
    HP_mist_coolant: string;
    LP_mist_coolant: string;
    mist_ival_coolant: string;
    mist_coolant_val: number;
    through_coolant: string;
    HP_through_coolant: string;
    LP_through_coolant: string;
    MP_through_coolant: string;
    through_ival_coolant: string;
    through_coolant_val: number;
    air_blast_coolant: string;
    air_through_coolant: string;
    minimum_quantity_L: string;
    minimum_quantity_L_val: number;
    mach_flood_coolant: string;
    mach_HP_flood_coolant: string;
    mach_LP_flood_coolant: string;
    mach_flood_ival_coolant: string;
    mach_flood_coolant_val: number;
    mach_mist_coolant: string;
    mach_HP_mist_coolant: string;
    mach_LP_mist_coolant: string;
    mach_mist_ival_coolant: string;
    mach_mist_coolant_val: number;
    mach_active_air_coolant: string;
    mach_bed_rinsing_coolant: string;
    mach_shower_coolant: string;
    mach_HP_shower_coolant: string;
    mach_LP_shower_coolant: string;
    mach_shower_ival_coolant: string;
    mach_shower_coolant_val: number;
  };
  Drill: {
    drill_depth: number;
    down_step: number;
    num_down_steps: number;
    xpos: number;
    ypos: number;
    zpos: number;
    feed: number;
    feed_teeth: number;
    drill_clearance_z: number;
    drill_upper_z: number;
    drill_lower_z: number;
    drill_type: number;
    d_drill_type: string;
    drill_cycle_name: string;
    spin: number;
    spin_teeth: number;
    retract_distance: number;
    release_type: string;
    release_distance: number;
    cpos: number;
    xhpos: number;
    yhpos: number;
    zhpos: number;
  };
  DrillPoint: {
    xpos: number;
    ypos: number;
    zpos: number;
    first_drill: boolean;
    xhpos: number;
    yhpos: number;
    zhpos: number;
  };
  EndDrill: {};
  EndProgram: {
    xpos: number;
    ypos: number;
    zpos: number;
    last_line: number;
  };
  HomeData: {
    part_home_number: number;
    mac_number: number;
    position: number;
    home_id: number;
    home_user_name: string;
    machine_plane: PlanEnum;
    tool_z_level: number;
    clearance_plane: number;
    tool_start_plane: number;
    work_upper_plane: number;
    zero_plane: number;
    rotate_angle_x: number;
    rotate_angle_y: number;
    rotate_angle_z: number;
    opposite_rotate_angle_x: number;
    opposite_rotate_angle_y: number;
    opposite_rotate_angle_z: number;
    rotate_angle_x_dir: DirectionEnum;
    rotate_angle_y_dir: DirectionEnum;
    rotate_angle_z_dir: DirectionEnum;
    x_angle_const_z: number;
    y_angle_const_z: number;
    dev_angle_z: number;
    opposite_x_angle_const_z: number;
    opposite_y_angle_const_z: number;
    opposite_dev_angle_z: number;
    x_angle_const_z_dir: DirectionEnum;
    y_angle_const_z_dir: DirectionEnum;
    dev_angle_z_dir: DirectionEnum;
    x_angle_const_y: number;
    z_angle_const_y: number;
    dev_angle_y: number;
    opposite_x_angle_const_y: number;
    opposite_z_angle_const_y: number;
    opposite_dev_angle_y: number;
    x_angle_const_y_dir: DirectionEnum;
    z_angle_const_y_dir: DirectionEnum;
    dev_angle_y_dir: DirectionEnum;
    y_angle_const_x: number;
    z_angle_const_x: number;
    dev_angle_x: number;
    opposite_y_angle_const_x: number;
    opposite_z_angle_const_x: number;
    opposite_dev_angle_x: number;
    y_angle_const_x_dir: DirectionEnum;
    z_angle_const_x_dir: DirectionEnum;
    dev_angle_x_dir: DirectionEnum;
    angle_4x_around_x: number;
    angle_4x_around_y: number;
    angle_4x_around_x_dir: DirectionEnum;
    angle_4x_around_y_dir: DirectionEnum;
    shift_x: number;
    shift_y: number;
    shift_z: number;
    shift_x_after_rot: number;
    shift_y_after_rot: number;
    shift_z_after_rot: number;
    tmatrix_I_1: number;
    tmatrix_I_2: number;
    tmatrix_I_3: number;
    tmatrix_I_4: number;
    tmatrix_I_5: number;
    tmatrix_I_6: number;
    tmatrix_I_7: number;
    tmatrix_I_8: number;
    tmatrix_I_9: number;
    tmatrix_I_10: number;
    tmatrix_I_11: number;
    tmatrix_I_12: number;
    tmatrix_I_13: number;
    tmatrix_I_14: number;
    tmatrix_I_15: number;
    tmatrix_I_16: number;
    used_in_auto: number;
    used_in_other: number;
    num_homes: number;
    machine_offset_x: number;
    machine_offset_y: number;
    machine_offset_z: number;
  };
  EndOfFile: {};
};

export type CommandsType = {
  Rapid: {
    x?: number;
    y?: number;
    z?: number;
    a?: number;
    b?: number;
    c?: number;
  };
  Line: {
    x?: number;
    y?: number;
    z?: number;
    a?: number;
    b?: number;
    c?: number;
    feed?: number;
  };
  SetSpindleSpeed: number;
  SetSpindleDirection: DirectionEnum;
  SetFeedRate: number;
  SetHomeNumber: number;
  SelectTool: string;
  Call: string;
  ExtCall: string;
  SetMachinePlane: PlanEnum;
};
